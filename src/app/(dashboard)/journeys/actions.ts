"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { JOURNEY_ENTRY_TYPES } from "@/lib/supabase/database.types";
import { toResult, type ActionResult } from "@/lib/action-result";

const journeySchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם למסע"),
  description: z.string().trim().optional(),
  entry_type: z.enum(JOURNEY_ENTRY_TYPES),
  status: z.string().trim().optional(),
  event_id: z.string().uuid().optional(),
  course_id: z.string().uuid().optional(),
});

/**
 * מה נשמר ב-entry_value, לפי סוג הכניסה.
 *
 * שלושה סוגים נושאים ערך: סטטוס, אירוע וקורס. השאר נגזרים מהיומן ואין להם
 * מה לצמצם — ולכן אובייקט ריק ולא null, כדי שהעמודה תישאר בעלת צורה אחת.
 */
function entryValueOf(data: z.infer<typeof journeySchema>) {
  if (data.entry_type === "status") return { status: data.status };
  if (data.entry_type === "event_interest") return { event_id: data.event_id };
  if (data.entry_type === "course_interest") return { course_id: data.course_id };
  return {};
}

/**
 * מחזירה תוצאה ולא זורקת.
 *
 * ההודעות כאן ("מסע למתעניינות בקורס חייב שיוגדר לו קורס") הן בדיוק הסוג
 * שנמחק בפרודקשן והוחלף בשגיאה גנרית של React — ר' 8dbd26d. toResult עוטף
 * את הגוף הקיים בלי לשנות ולו ניסוח אחד, ומעביר את ה-redirect שבסופו הלאה
 * כמו שהוא.
 */
export async function createJourneyAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const parsed = journeySchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      entry_type: formData.get("entry_type"),
      status: formData.get("status") || undefined,
      event_id: formData.get("event_id") || undefined,
      course_id: formData.get("course_id") || undefined,
    });
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

    if (parsed.data.entry_type === "status" && !parsed.data.status) {
      throw new Error("מסע שנכנסים אליו לפי סטטוס חייב שיוגדר לו סטטוס");
    }
    if (parsed.data.entry_type === "event_interest" && !parsed.data.event_id) {
      throw new Error("מסע למתעניינות באירוע חייב שיוגדר לו אירוע");
    }
    if (parsed.data.entry_type === "course_interest" && !parsed.data.course_id) {
      throw new Error("מסע למתעניינות בקורס חייב שיוגדר לו קורס");
    }

    const { data, error } = await supabaseAdmin()
      .from("journeys")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        entry_type: parsed.data.entry_type,
        entry_value: entryValueOf(parsed.data),
      })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath("/journeys");
    redirect(`/journeys/${data.id}`);
  });
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
