"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  countStages,
  findOrCreateContact,
  getActiveEventBySlug,
  spotsLeft,
  strongerStage,
} from "@/lib/events";
import type { EventStage } from "@/lib/supabase/database.types";
import type { RegisterState } from "@/components/event-page";

/**
 * ההרשמה מדף האירוע הציבורי.
 *
 * זהו Server Action שנקרא מדפדפן של אדם אנונימי — אין כאן verifyTeamMember,
 * בדיוק כמו ב-/book. ההגנה היא ולידציה קפדנית והעובדה שהוא כותב בלבד ואינו
 * מחזיר שום מידע על האירוע או על מי שכבר נרשם.
 */

const registrationSchema = z.object({
  full_name: z.string().trim().min(1, "חסר שם מלא").max(120),
  phone: z.string().trim().min(1, "חסר טלפון").max(20),
  email: z.string().trim().min(1, "חסר אימייל").max(160),
});

export async function registerForEventAction(
  slug: string,
  _state: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const parsed = registrationSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const event = await getActiveEventBySlug(slug);
  if (!event) return { error: "האירוע אינו פתוח להרשמה" };

  const db = supabaseAdmin();

  const contact = await findOrCreateContact(
    db,
    {
      fullName: parsed.data.full_name,
      phone: parsed.data.phone,
      email: parsed.data.email,
    },
    event.name
  );
  if ("error" in contact) return { error: contact.error };

  // התשובות לשדות המותאמים, לפי מה שהאירוע באמת מגדיר. הקריאה היא מהאירוע
  // ולא מה-FormData: כך שדה שמישהו הזריק לטופס מבחוץ פשוט לא נקרא.
  const answers: Record<string, string> = {};
  for (const field of event.custom_fields) {
    const value = formData.get(`custom_${field.key}`);
    if (typeof value === "string" && value.trim()) answers[field.key] = value.trim().slice(0, 500);
  }

  // הקיבולת נבדקת כאן ולא רק ברינדור: בין רגע טעינת הדף לרגע השליחה יכולים
  // להיכנס עוד אנשים, ומי שהגיעה למקום שכבר נתפס נרשמת כמתעניינת — לא
  // כנרשמת שתישלח לתשלום על מקום שאין.
  const counts = await countStages(event.id);
  const left = spotsLeft(event, counts.paid);
  const isFull = left !== null && left === 0;
  const targetStage: EventStage = isFull ? "interested" : "registered";

  const { data: existing, error: findError } = await db
    .from("event_registrations")
    .select("id, stage, answers")
    .eq("event_id", event.id)
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (findError) return { error: findError.message };

  const stage = strongerStage(existing?.stage, targetStage);

  const { error: writeError } = existing
    ? await db
        .from("event_registrations")
        // מיזוג ולא דריסה: מי שממלאת את הטופס שוב ומשאירה שדה לא-חובה ריק
        // לא אמורה למחוק בכך את מה שענתה עליו בפעם הקודמת.
        .update({ stage, answers: { ...existing.answers, ...answers } })
        .eq("id", existing.id)
    : await db.from("event_registrations").insert({
        event_id: event.id,
        contact_id: contact.id,
        stage,
        source: "landing",
        answers,
      });

  if (writeError) {
    // מרוץ: אותו אדם שלח את הטופס פעמיים במקביל. ה-unique תפס, וזה בסדר
    // גמור — הרישום קיים, ואפשר להמשיך כרגיל לתשלום.
    if (writeError.code !== "23505") return { error: writeError.message };
  }

  // ביומן נרשם רק מעבר לשלב חדש, כדי שרענון של הדף לא יציף אותו.
  if (!existing || existing.stage !== stage) {
    const { error: logError } = await db.from("interactions").insert({
      contact_id: contact.id,
      type: "event_registered",
      content: isFull
        ? `נרשמה לרשימת המתנה: ${event.name}`
        : `נרשמה לאירוע: ${event.name}`,
    });
    // נרשם ללוג ולא מוחזר למשתמשת: היומן הוא תיעוד פנימי, וכישלון שלו לא
    // מצדיק להכשיל הרשמה שכבר נשמרה. אבל הוא כן חייב להישמע — בדיוק השתיקה
    // הזו היא שהסתירה את העובדה ש-event_registered חסר ב-enum (ראו 0025).
    if (logError) console.error("[event] רישום ביומן איש הקשר נכשל:", logError.message);
  }

  revalidatePath(`/events/${event.id}`);

  // redirect זורק, ולכן הוא מחוץ לכל try — עטיפה שלו הייתה בולעת את הניווט
  // והופכת אותו לשגיאה. אירוע מלא לא נשלח לתשלום גם אם יש לינק גרואו.
  if (!isFull && event.grow_link) redirect(event.grow_link);
  redirect(`/event/${event.slug}/thanks`);
}
