"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listFields, generateFieldKey } from "@/lib/fields";
import { FIELD_INPUT_TYPES, type FieldInputType } from "@/lib/supabase/database.types";

// ניהול contact_fields (0006_fields.sql).

function revalidateAll() {
  revalidatePath("/fields");
  revalidatePath("/contacts");
}

function readLabel(formData: FormData): string {
  return String(formData.get("label") ?? "").trim().replace(/\s+/g, " ");
}

function readInputType(formData: FormData): FieldInputType {
  const value = String(formData.get("input_type") ?? "");
  return (FIELD_INPUT_TYPES as readonly string[]).includes(value)
    ? (value as FieldInputType)
    : "text";
}

export async function createFieldAction(formData: FormData) {
  await verifyTeamMember();

  const label = readLabel(formData);
  if (!label) throw new Error("חובה למלא שם שדה");
  if (label.length > 40) throw new Error("שם השדה ארוך מדי (עד 40 תווים)");

  const fields = await listFields();
  if (fields.some((f) => f.label === label)) throw new Error(`כבר קיים שדה בשם "${label}"`);

  const maxOrder = fields.reduce((max, f) => Math.max(max, f.sort_order), 0);

  const { error } = await supabaseAdmin().from("contact_fields").insert({
    key: generateFieldKey(),
    label,
    kind: "custom",
    input_type: readInputType(formData),
    sort_order: maxOrder + 10,
    show_in_table: formData.get("show_in_table") === "on",
    editable: true,
  });
  if (error) throw error;

  revalidateAll();
}

/**
 * שינוי שם/סוג/הצגה. ה-key לא נגזר מה-label ולכן שינוי שם הוא עדכון שורה
 * אחת — אין צורך לגעת בערכים של אף איש קשר.
 */
export async function updateFieldAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const label = readLabel(formData);
  if (!id) throw new Error("חסר מזהה שדה");
  if (!label) throw new Error("חובה למלא שם שדה");

  const fields = await listFields();
  const current = fields.find((f) => f.id === id);
  if (!current) throw new Error("השדה לא נמצא");
  if (fields.some((f) => f.id !== id && f.label === label)) {
    throw new Error(`כבר קיים שדה בשם "${label}"`);
  }

  const { error } = await supabaseAdmin()
    .from("contact_fields")
    .update({
      label,
      show_in_table: formData.get("show_in_table") === "on",
      // סוג הקלט של שדה מובנה נגזר מהעמודה עצמה ואין טעם לשנות אותו
      ...(current.kind === "custom" ? { input_type: readInputType(formData) } : {}),
    })
    .eq("id", id);
  if (error) throw error;

  revalidateAll();
}

/**
 * מחיקת שדה מותאם. מוחקת גם את הערכים מכל אנשי הקשר — שדה שנעלם מהממשק
 * אבל משאיר נתונים בלתי נראים ב-jsonb הוא מלכודת: ייבוא עתידי עם אותו שם
 * היה מקבל key חדש, והישן היה נשאר שם לנצח בלי שאף אחד יוכל לראות אותו.
 *
 * שדה builtin לא ניתן למחיקה — מנוע האוטומציה, ה-webhooks והתבניות פונים
 * אליו בשמו. אפשר רק להסתיר אותו מהטבלה.
 */
export async function deleteFieldAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const field = (await listFields()).find((f) => f.id === id);
  if (!field) throw new Error("השדה לא נמצא");
  if (field.kind === "builtin") {
    throw new Error("שדה מובנה לא ניתן למחיקה — אפשר להסתיר אותו מהטבלה");
  }

  const db = supabaseAdmin();

  // PostgREST לא חושף את אופרטור ה-"מפתח קיים" של jsonb (‎?‎), ו-cs מתאים רק
  // להתאמת ערך מדויקת — אז שולפים id+custom ומסננים כאן. הרשימה קטנה (שדה
  // אחד מתוך אלפי אנשי קשר לכל היותר), וזו פעולה נדירה של מחיקת שדה.
  const { data: contacts, error: fetchError } = await db.from("contacts").select("id, custom");
  if (fetchError) throw fetchError;

  const withValue = (contacts ?? []).filter(
    (c) => c.custom && Object.prototype.hasOwnProperty.call(c.custom, field.key)
  );

  for (const contact of withValue) {
    const next = { ...contact.custom };
    delete next[field.key];
    const { error } = await db.from("contacts").update({ custom: next }).eq("id", contact.id);
    if (error) throw error;
  }

  const { error } = await db.from("contact_fields").delete().eq("id", id);
  if (error) throw error;

  revalidateAll();
}

/** סדר השדות — קובע גם את סדר העמודות בטבלה וגם את סדר השדות בכרטיס. */
export async function moveFieldAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const direction = String(formData.get("direction") ?? "");

  const fields = await listFields();
  const index = fields.findIndex((f) => f.id === id);
  if (index < 0) throw new Error("השדה לא נמצא");

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= fields.length) return;

  const reordered = [...fields];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

  const db = supabaseAdmin();
  for (const [position, field] of reordered.entries()) {
    const nextOrder = (position + 1) * 10;
    if (field.sort_order === nextOrder) continue;
    const { error } = await db
      .from("contact_fields")
      .update({ sort_order: nextOrder })
      .eq("id", field.id);
    if (error) throw error;
  }

  revalidateAll();
}
