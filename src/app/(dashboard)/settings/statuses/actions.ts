"use server";

import { revalidatePath } from "next/cache";
import { toResult, type ActionResult } from "@/lib/action-result";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import { STATUS_COLORS, type StatusColor } from "@/lib/status-colors";

// ניהול טבלת contact_statuses (0003_statuses.sql). כל פעולה כאן מרעננת גם את
// /contacts ואת /rules, כי שתיהן בונות רשימות בחירה מהסטטוסים.

function revalidateAll() {
  revalidatePath("/settings/statuses");
  revalidatePath("/contacts");
  revalidatePath("/rules");
}

function readName(formData: FormData): string {
  // רווחים כפולים ורווחים בקצוות הופכים שני סטטוסים שנראים זהים לשונים
  // מבחינת ה-unique constraint, ואז אי אפשר להבין למה השם "כבר תפוס".
  return String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
}

function readColor(formData: FormData): StatusColor {
  const value = String(formData.get("color") ?? "");
  return (STATUS_COLORS as string[]).includes(value) ? (value as StatusColor) : "stone";
}

export async function createStatusAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const name = readName(formData);
    if (!name) throw new Error("חובה למלא שם סטטוס");
    if (name.length > 40) throw new Error("שם הסטטוס ארוך מדי (עד 40 תווים)");

    const statuses = await listStatuses();
    if (statuses.some((s) => s.name === name)) throw new Error(`הסטטוס "${name}" כבר קיים`);

    const maxOrder = statuses.reduce((max, s) => Math.max(max, s.sort_order), 0);

    const { error } = await supabaseAdmin()
      .from("contact_statuses")
      .insert({ name, color: readColor(formData), sort_order: maxOrder + 10 });
    if (error) throw new Error(error.code === "23505" ? `הסטטוס "${name}" כבר קיים` : error.message);

    revalidateAll();
  });
}

/**
 * עריכת סטטוס קיים. שינוי שם מתגלגל אוטומטית לכל אנשי הקשר דרך
 * ‎on update cascade‎ שעל המפתח הזר, אבל כללי אוטומציה שומרים את שם הסטטוס
 * בתוך trigger_value שהוא jsonb — ולשם ה-cascade לא מגיע. לכן מפנים אותם כאן.
 */
export async function updateStatusAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    const name = readName(formData);
    if (!id) throw new Error("חסר מזהה סטטוס");
    if (!name) throw new Error("חובה למלא שם סטטוס");
    if (name.length > 40) throw new Error("שם הסטטוס ארוך מדי (עד 40 תווים)");

    const statuses = await listStatuses();
    const current = statuses.find((s) => s.id === id);
    if (!current) throw new Error("הסטטוס לא נמצא");
    if (statuses.some((s) => s.id !== id && s.name === name)) {
      throw new Error(`הסטטוס "${name}" כבר קיים`);
    }

    const { error } = await supabaseAdmin()
      .from("contact_statuses")
      .update({ name, color: readColor(formData) })
      .eq("id", id);
    if (error) throw new Error(error.code === "23505" ? `הסטטוס "${name}" כבר קיים` : error.message);

    if (name !== current.name) await repointRules(current.name, name);

    revalidateAll();
  });
}

/**
 * מחיקת סטטוס. ה-FK הוא ‎on delete restrict‎, אז סטטוס שעדיין בשימוש חייב
 * קודם יעד להעביר אליו את אנשי הקשר — הטופס בעמוד מבקש אותו.
 *
 * ההעברה נכתבת ישירות ל-contacts.status ולא דרך updateContactStatus: מחיקת
 * סטטוס עם 80 אנשי קשר לא אמורה לירות כלל status_change ולשלוח להם 80 הודעות.
 */
export async function deleteStatusAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    const moveToId = String(formData.get("move_to") ?? "");

    const statuses = await listStatuses();
    const target = statuses.find((s) => s.id === id);
    if (!target) throw new Error("הסטטוס לא נמצא");
    if (statuses.length === 1) throw new Error("אי אפשר למחוק את הסטטוס האחרון שנשאר");

    const db = supabaseAdmin();

    const { count, error: countError } = await db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("status", target.name);
    if (countError) throw countError;

    const inUse = count ?? 0;
    let replacement: string | null = null;

    if (inUse > 0) {
      const moveTo = statuses.find((s) => s.id === moveToId && s.id !== id);
      if (!moveTo) {
        throw new Error(
          `לסטטוס "${target.name}" משויכים ${inUse} אנשי קשר — בחרו סטטוס להעביר אליהם לפני המחיקה`
        );
      }
      replacement = moveTo.name;

      const { error: moveError } = await db
        .from("contacts")
        .update({ status: moveTo.name })
        .eq("status", target.name);
      if (moveError) throw moveError;
    }

    // כללי אוטומציה מצביעים על הסטטוס בתוך jsonb, בלי מפתח זר שיגן עליהם.
    // בלי זה, כלל "זמן ללא מענה" היה נשאר עם סטטוס יעד שכבר לא קיים ומפסיק
    // לירות בשקט, בלי שום סימן בדשבורד.
    await repointRules(target.name, replacement);

    const { error } = await db.from("contact_statuses").delete().eq("id", id);
    if (error) {
      // 23503 = הפרת מפתח זר. לא רק contacts מפנה לשם הסטטוס — גם
      // booking_event_types.set_contact_status (0005_booking.sql), ואולי עוד
      // בעתיד. לכן ההודעה כללית ולא מדברת רק על אנשי קשר.
      throw new Error(
        error.code === "23503"
          ? `לא ניתן למחוק — משהו במערכת עדיין מפנה לסטטוס "${target.name}" (איש קשר שנוסף בינתיים, או סוג פגישה שמגדיר אותו)`
          : error.message
      );
    }

    revalidateAll();
  });
}

/** שינוי סדר. הסטטוס הראשון ברשימה הוא גם ברירת המחדל של ליד חדש. */
export async function moveStatusAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    const direction = String(formData.get("direction") ?? "");

    const statuses = await listStatuses();
    const index = statuses.findIndex((s) => s.id === id);
    if (index < 0) throw new Error("הסטטוס לא נמצא");

    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= statuses.length) return;

    const db = supabaseAdmin();
    // sort_order נזרע בקפיצות של 10, אבל אחרי כמה החלפות אפשר להגיע לערכים
    // זהים; כתיבה מחדש של כל הרשימה לפי המיקום שומרת אותה תמיד חד-משמעית.
    const reordered = [...statuses];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    for (const [position, status] of reordered.entries()) {
      const nextOrder = (position + 1) * 10;
      if (status.sort_order === nextOrder) continue;
      const { error } = await db
        .from("contact_statuses")
        .update({ sort_order: nextOrder })
        .eq("id", status.id);
      if (error) throw error;
    }

    revalidateAll();
  });
}

/**
 * מפנה כללי אוטומציה שמזכירים שם סטטוס. `to === null` (מחיקה בלי יעד, כלומר
 * הסטטוס לא היה בשימוש) מכבה כלל "זמן ללא מענה" שנשאר בלי סטטוס יעד, ומרוקן
 * את from_status של כלל "שינוי סטטוס" — שמשמעותו ממילא "כל סטטוס".
 */
async function repointRules(from: string, to: string | null) {
  const db = supabaseAdmin();

  const { data: rules, error } = await db.from("automation_rules").select("*");
  if (error) throw error;

  for (const rule of rules ?? []) {
    const value = (rule.trigger_value ?? {}) as Record<string, unknown>;
    if (value.from_status !== from && value.status !== from) continue;

    const patch: Record<string, unknown> = { ...value };
    let deactivate = false;

    if (patch.from_status === from) {
      if (to) patch.from_status = to;
      else delete patch.from_status;
    }
    if (patch.status === from) {
      if (to) patch.status = to;
      else deactivate = true;
    }

    const { error: updateError } = await db
      .from("automation_rules")
      .update({
        trigger_value: patch as never,
        ...(deactivate ? { active: false } : {}),
      })
      .eq("id", rule.id);
    if (updateError) throw updateError;
  }
}
