"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { JOURNEY_ENTRY_TYPES, JOURNEY_ANCHORS } from "@/lib/supabase/database.types";

const journeySchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם למסע"),
  description: z.string().trim().optional(),
  entry_type: z.enum(JOURNEY_ENTRY_TYPES),
  status: z.string().trim().optional(),
  anchor: z.enum(JOURNEY_ANCHORS),
});

export async function createJourneyAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = journeySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    entry_type: formData.get("entry_type"),
    status: formData.get("status") || undefined,
    anchor: formData.get("anchor") || "enrollment",
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

  if (parsed.data.entry_type === "status" && !parsed.data.status) {
    throw new Error("מסע שנכנסים אליו לפי סטטוס חייב שיוגדר לו סטטוס");
  }

  // עיגון לפגישה דורש שתהיה פגישה. מסע שנכנסים אליו לפי סטטוס לא מבטיח את
  // זה, והצירוף היה מדלג על כולם בשקט — מצב שנראה כמו "המסע לא עובד".
  if (parsed.data.anchor === "booking" && parsed.data.entry_type !== "booking") {
    throw new Error(
      "מסע שמעוגן למועד הפגישה חייב שהכניסה אליו תהיה \"קבע פגישה\" — אחרת אין ממה לחשב את המועד."
    );
  }

  const { data, error } = await supabaseAdmin()
    .from("journeys")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      entry_type: parsed.data.entry_type,
      entry_value: parsed.data.entry_type === "status" ? { status: parsed.data.status } : {},
      anchor: parsed.data.anchor,
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
