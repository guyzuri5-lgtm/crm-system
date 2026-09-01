"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  JOURNEY_ENTRY_TYPES,
  JOURNEY_CONDITIONS,
  MESSAGE_CHANNELS,
} from "@/lib/supabase/database.types";

const journeySchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם למסע"),
  description: z.string().trim().optional(),
  entry_type: z.enum(JOURNEY_ENTRY_TYPES),
  status: z.string().trim().optional(),
});

export async function createJourneyAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = journeySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    entry_type: formData.get("entry_type"),
    status: formData.get("status") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

  if (parsed.data.entry_type === "status" && !parsed.data.status) {
    throw new Error("מסע שנכנסים אליו לפי סטטוס חייב שיוגדר לו סטטוס");
  }

  const { data, error } = await supabaseAdmin()
    .from("journeys")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      entry_type: parsed.data.entry_type,
      entry_value: parsed.data.entry_type === "status" ? { status: parsed.data.status } : {},
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/journeys");
  redirect(`/journeys/${data.id}`);
}

export async function deleteJourneyAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  // cascade מוריד גם את השלבים ואת הצירופים. זו מחיקה של היסטוריה, ולכן
  // הכפתור בדשבורד שואל לפני.
  const { error } = await supabaseAdmin().from("journeys").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/journeys");
  redirect("/journeys");
}

/**
 * הדלקה וכיבוי של מסע.
 *
 * הדלקה היא הפעולה המסוכנת כאן: מהרגע הזה הקרון מצרף אנשים אמיתיים ושולח
 * להם הודעות אמיתיות. לכן מסע בלי שלבים לא נדלק — הוא היה מצרף את כולם
 * ומסמן אותם "סיים" בלי לשלוח דבר, וזה מצב שאי אפשר לחזור ממנו: ה-unique
 * על (journey_id, contact_id) מונע צירוף חוזר.
 */
export async function toggleJourneyAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const next = formData.get("active") === "true";
  const db = supabaseAdmin();

  if (next) {
    const { count, error } = await db
      .from("journey_steps")
      .select("id", { count: "exact", head: true })
      .eq("journey_id", id);
    if (error) throw error;
    if (!count) {
      throw new Error(
        "אי אפשר להפעיל מסע בלי שלבים — כל מי שהיה נכנס אליו היה מסומן כמי שסיים, ולא ניתן לצרף אותו שוב."
      );
    }
  }

  const { error } = await db.from("journeys").update({ active: next }).eq("id", id);
  if (error) throw error;

  revalidatePath("/journeys");
  revalidatePath(`/journeys/${id}`);
}

const stepSchema = z.object({
  journey_id: z.string().uuid(),
  wait_days: z.coerce.number().int().min(0).max(365),
  channel: z.enum(MESSAGE_CHANNELS),
  template_id: z.string().uuid("צריך לבחור תבנית"),
  condition: z.enum(JOURNEY_CONDITIONS),
});

export async function addStepAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = stepSchema.safeParse({
    journey_id: formData.get("journey_id"),
    wait_days: formData.get("wait_days") || 0,
    channel: formData.get("channel"),
    template_id: formData.get("template_id"),
    condition: formData.get("condition") || "always",
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

  const db = supabaseAdmin();

  // המיקום נגזר מהקיים ולא מגיע מהטופס — שני טפסים שנשלחו יחד היו מקבלים
  // אותו מספר, וה-unique היה דוחה את השני בשגיאה לא מובנת.
  const { data: last, error: lastError } = await db
    .from("journey_steps")
    .select("position")
    .eq("journey_id", parsed.data.journey_id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const { error } = await db.from("journey_steps").insert({
    ...parsed.data,
    position: (last?.position ?? 0) + 1,
  });
  if (error) throw error;

  revalidatePath(`/journeys/${parsed.data.journey_id}`);
}

export async function deleteStepAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");
  const db = supabaseAdmin();

  const { error } = await db.from("journey_steps").delete().eq("id", id);
  if (error) throw error;

  // סגירת החור במספור. בלעדיה מסע עם שלבים 1,3 היה נתקע: המנוע מחפש את
  // position הבא בדיוק, ו-2 שנעלם היה מסיים את המסע לכולם באמצע.
  const { data: rest, error: restError } = await db
    .from("journey_steps")
    .select("id, position")
    .eq("journey_id", journeyId)
    .order("position", { ascending: true });
  if (restError) throw restError;

  await Promise.all(
    (rest ?? []).map((step, index) =>
      step.position === index + 1
        ? Promise.resolve()
        : db.from("journey_steps").update({ position: index + 1 }).eq("id", step.id)
    )
  );

  revalidatePath(`/journeys/${journeyId}`);
}

/** עצירה ידנית של אדם אחד באמצע מסע. */
export async function stopEnrollmentAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");

  const { error } = await supabaseAdmin()
    .from("journey_enrollments")
    .update({ state: "stopped_manual" })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

/** מתג "תגובה מסיימת את המסע". כיבויו הוא מה שפותח מסלולים נפרדים. */
export async function toggleStopOnReplyAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const next = formData.get("stop_on_reply") === "true";

  const { error } = await supabaseAdmin()
    .from("journeys")
    .update({ stop_on_reply: next })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${id}`);
}

/**
 * שינוי סדר השלבים — מקבל את המזהים בסדר החדש.
 *
 * הכתיבה היא בשני מעברים ולא באחד: ה-unique על (journey_id, position) היה
 * נשבר באמצע כל החלפה, כי שני שלבים היו מחזיקים רגע את אותו מספר. המעבר
 * הראשון מזיז את כולם לטווח שלילי פנוי, והשני מציב אותם בסדר הסופי.
 */
export async function reorderStepsAction(formData: FormData) {
  await verifyTeamMember();

  const journeyId = String(formData.get("journey_id") ?? "");
  const ids = String(formData.get("order") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!journeyId || !ids.length) return;

  const db = supabaseAdmin();

  for (const [i, id] of ids.entries()) {
    const { error } = await db
      .from("journey_steps")
      .update({ position: -(i + 1) })
      .eq("id", id)
      .eq("journey_id", journeyId);
    if (error) throw error;
  }

  for (const [i, id] of ids.entries()) {
    const { error } = await db
      .from("journey_steps")
      .update({ position: i + 1 })
      .eq("id", id)
      .eq("journey_id", journeyId);
    if (error) throw error;
  }

  revalidatePath(`/journeys/${journeyId}`);
}
