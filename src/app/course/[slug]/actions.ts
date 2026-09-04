"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getActiveCourseBySlug } from "@/lib/courses";
import { findOrCreateContact, strongerStage } from "@/lib/registration";
import type { RegisterState } from "@/components/registration-page";

/**
 * ההרשמה מדף הקורס הציבורי.
 *
 * Server Action שנקרא מדפדפן של אדם אנונימי — אין כאן verifyTeamMember,
 * בדיוק כמו ב-/book וב-/event. ההגנה היא ולידציה קפדנית והעובדה שהוא כותב
 * בלבד ואינו מחזיר שום מידע על הקורס או על מי שכבר נרשם.
 *
 * ההבדל היחיד מההרשמה לאירוע הוא מה שאין: אין קיבולת לבדוק, ולכן אין מסלול
 * "מלא → רשימת המתנה". כל נרשמת עוברת ישר ל-registered ומשם לתשלום.
 */

const registrationSchema = z.object({
  full_name: z.string().trim().min(1, "חסר שם מלא").max(120),
  phone: z.string().trim().min(1, "חסר טלפון").max(20),
  email: z.string().trim().min(1, "חסר אימייל").max(160),
});

/**
 * ההרשמה עצמה, בלי להחליט מה קורה אחריה.
 *
 * ההפרדה קיימת בגלל ההטמעה: בדף העצמאי הסיום הוא redirect בשרת, ובתוך iframe
 * הוא חייב לקרות בלקוח — הפניה רגילה הייתה טוענת את דף התשלום *בתוך* המסגרת
 * הקטנה שבדף הנחיתה. שתי התנהגויות, לוגיקת הרשמה אחת.
 */
async function register(
  slug: string,
  formData: FormData
): Promise<{ error: string } | { growLink: string | null; slug: string }> {
  const parsed = registrationSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const course = await getActiveCourseBySlug(slug);
  if (!course) return { error: "הקורס אינו פתוח להרשמה" };

  const db = supabaseAdmin();

  const contact = await findOrCreateContact(
    db,
    {
      fullName: parsed.data.full_name,
      phone: parsed.data.phone,
      email: parsed.data.email,
    },
    `קורס: ${course.name}`
  );
  if ("error" in contact) return { error: contact.error };

  // התשובות לשדות המותאמים, לפי מה שהקורס באמת מגדיר. הקריאה היא מהקורס ולא
  // מה-FormData: כך שדה שמישהו הזריק לטופס מבחוץ פשוט לא נקרא.
  const answers: Record<string, string> = {};
  for (const field of course.custom_fields) {
    const value = formData.get(`custom_${field.key}`);
    if (typeof value === "string" && value.trim()) answers[field.key] = value.trim().slice(0, 500);
  }

  const { data: existing, error: findError } = await db
    .from("course_registrations")
    .select("id, stage, answers")
    .eq("course_id", course.id)
    .eq("contact_id", contact.id)
    .maybeSingle();
  if (findError) return { error: findError.message };

  const stage = strongerStage(existing?.stage, "registered");

  const { error: writeError } = existing
    ? await db
        .from("course_registrations")
        // מיזוג ולא דריסה: מי שממלאת את הטופס שוב ומשאירה שדה לא-חובה ריק לא
        // אמורה למחוק בכך את מה שענתה עליו בפעם הקודמת.
        .update({ stage, answers: { ...existing.answers, ...answers } })
        .eq("id", existing.id)
    : await db.from("course_registrations").insert({
        course_id: course.id,
        contact_id: contact.id,
        stage,
        source: "landing",
        answers,
      });

  if (writeError) {
    // מרוץ: אותו אדם שלח את הטופס פעמיים במקביל. ה-unique תפס, וזה בסדר גמור
    // — הרישום קיים, ואפשר להמשיך כרגיל לתשלום.
    if (writeError.code !== "23505") return { error: writeError.message };
  }

  // ביומן נרשם רק מעבר לשלב חדש, כדי שרענון של הדף לא יציף אותו.
  if (!existing || existing.stage !== stage) {
    const { error: logError } = await db.from("interactions").insert({
      contact_id: contact.id,
      type: "course_registered",
      content: `נרשמה לקורס: ${course.name}`,
    });
    // נרשם ללוג ולא מוחזר למשתמשת: היומן הוא תיעוד פנימי, וכישלון שלו לא
    // מצדיק להכשיל הרשמה שכבר נשמרה. אבל הוא כן חייב להישמע — בדיוק השתיקה
    // הזו הסתירה ש-event_registered חסר ב-enum (ראו 0025), ו-course_registered
    // תלוי באותו אופן בכך ש-0028 הורצה.
    if (logError) console.error("[course] רישום ביומן איש הקשר נכשל:", logError.message);
  }

  revalidatePath(`/courses/${course.id}`);

  return { growLink: course.grow_link, slug: course.slug };
}

/** הדף העצמאי: מסיים בהפניה מהשרת, כמו כל טופס רגיל. */
export async function registerForCourseAction(
  slug: string,
  _state: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const result = await register(slug, formData);
  if ("error" in result) return { error: result.error };

  // redirect זורק, ולכן הוא מחוץ לכל try — עטיפה שלו הייתה בולעת את הניווט
  // והופכת אותו לשגיאה.
  if (result.growLink) redirect(result.growLink);
  redirect(`/course/${result.slug}/thanks`);
}

/**
 * גרסת ההטמעה: מחזירה לאן ללכת במקום ללכת לשם.
 *
 * הניווט נעשה בלקוח (ראו RegistrationEmbed) כי רק שם אפשר להבחין בין שני
 * המקרים: תשלום חייב לקחת את *כל* החלון — דף גרואו בתוך מסגרת של 420
 * פיקסלים אינו דף תשלום שמישהי תשלים — ואילו הודעת התודה דווקא נכון שתופיע
 * במקום, בלי לגרור את הגולשת מדף הנחיתה שלך.
 */
export async function registerForCourseEmbedAction(
  slug: string,
  _state: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const result = await register(slug, formData);
  if ("error" in result) return { error: result.error };
  return { error: null, done: true, redirectTo: result.growLink };
}
