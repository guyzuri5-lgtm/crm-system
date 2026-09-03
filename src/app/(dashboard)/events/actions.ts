"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadPublicImage } from "@/lib/media";
import { EVENT_TIMEZONE } from "@/lib/events";
import { clockToMinutes, parseDateKey, zonedTimeToUtc } from "@/lib/booking/timezone";
import type { EventCustomField } from "@/lib/supabase/database.types";

// כל הפעולות של לשונית "אירועים". verifyTeamMember בראש כל אחת — Server Action
// הוא endpoint לכל דבר, וההגנה של proxy.ts על הנתיב אינה חלה עליו.

export type EventResult = { ok: true; id?: string } | { ok: false; error: string };
export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const MIGRATION_HINT =
  "טבלאות האירועים לא קיימות. יש להריץ את supabase/migrations/0024_events.sql ב-SQL editor של Supabase.";

/** הודעה מובנת במקום הקוד הגולמי של PostgREST כשהמיגרציה לא רצה. */
function explain(error: { code?: string; message: string }): string {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")
    ? MIGRATION_HINT
    : error.message;
}

const slugField = z
  .string()
  .trim()
  .min(1, "חובה למלא כתובת לקישור")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "הכתובת יכולה להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד");

/**
 * תאריך ושעה נקראים כשעון קיר בישראל ולא כ-UTC: מי שכותב 19:00 מתכוון לשבע
 * בערב אצלו, ובאוגוסט זה 16:00Z ובינואר 17:00Z. אותו נימוק בדיוק כמו בתזמון
 * הניוזלטר.
 */
function startsAtFrom(date: string, time: string): Date | { error: string } {
  const parsed = parseDateKey(date);
  const minutes = clockToMinutes(time);
  if (!parsed || minutes === null) return { error: "תאריך או שעה לא תקינים" };
  return zonedTimeToUtc(parsed.year, parsed.month, parsed.day, minutes, EVENT_TIMEZONE);
}

/** ריק → null. קיבולת ריקה פירושה "בלי הגבלה", לא "אפס מקומות". */
const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => value || null);

const capacityField = z
  .union([z.coerce.number().int().min(1).max(100_000), z.literal("")])
  .optional()
  .transform((value) => (value === "" || value === undefined ? null : value));

// ── יצירה ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם לאירוע").max(160),
  slug: slugField,
  date: z.string().trim().min(1, "חובה לבחור תאריך"),
  time: z.string().trim().min(1, "חובה לבחור שעה"),
  location: optionalText,
  capacity: capacityField,
  grow_link: optionalText,
  remind_day_before: z.coerce.boolean(),
  remind_hour_before: z.coerce.boolean(),
});

/**
 * יוצרת אירוע עם שדות הבסיס בלבד, ומעבירה מיד לעורך העיצוב.
 *
 * הפיצול הזה מכוון: מי שיוצר אירוע חושב קודם על *מה* ומתי, ורק אחר כך על
 * איך הדף ייראה. טופס אחד עם שלושים שדות היה מבקש את שתי ההחלטות בבת אחת.
 */
export async function createEventAction(
  _state: EventResult | null,
  formData: FormData
): Promise<EventResult> {
  await verifyTeamMember();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    date: formData.get("date"),
    time: formData.get("time"),
    location: formData.get("location") ?? "",
    capacity: formData.get("capacity") ?? "",
    grow_link: formData.get("grow_link") ?? "",
    remind_day_before: formData.get("remind_day_before") === "on",
    remind_hour_before: formData.get("remind_hour_before") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const startsAt = startsAtFrom(parsed.data.date, parsed.data.time);
  if ("error" in startsAt) return { ok: false, error: startsAt.error };

  const { data, error } = await supabaseAdmin()
    .from("events")
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      starts_at: startsAt.toISOString(),
      location: parsed.data.location,
      capacity: parsed.data.capacity,
      grow_link: parsed.data.grow_link,
      remind_day_before: parsed.data.remind_day_before,
      remind_hour_before: parsed.data.remind_hour_before,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "הכתובת הזו כבר תפוסה על ידי אירוע אחר" };
    }
    return { ok: false, error: explain(error) };
  }

  revalidatePath("/events");
  // ה-redirect מחוץ ל-try ואחרי כל הכתיבות — הוא זורק, וטיפול בו כשגיאה
  // היה מציג "משהו השתבש" על פעולה שהצליחה.
  redirect(`/events/${data.id}/edit`);
}

// ── עורך העיצוב ────────────────────────────────────────────────────────────

const customFieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "לשדה מותאם חסרה תווית").max(120),
  type: z.enum(["text", "select"]),
  options: z.array(z.string().trim().min(1).max(120)).max(30),
});

const designSchema = z.object({
  // דף ההרשמה
  name: z.string().trim().min(1, "חובה למלא שם לאירוע").max(160),
  subtitle: optionalText,
  form_description: optionalText,
  button_text: z.string().trim().min(1, "לכפתור חייב להיות טקסט").max(80),
  header_image_url: z.union([z.string().url(), z.literal("")]).transform((v) => v || null),
  show_datetime: z.boolean(),
  show_capacity: z.boolean(),
  // דף התודה
  thankyou_title: z.string().trim().min(1, "לעמוד התודה חייבת להיות כותרת").max(160),
  thankyou_text: optionalText,
  thankyou_show_calendar: z.boolean(),
  thankyou_show_image: z.boolean(),
  // שדות הטופס ושדות הבסיס
  custom_fields: z.array(customFieldSchema).max(20),
  date: z.string().trim().min(1, "חובה לבחור תאריך"),
  time: z.string().trim().min(1, "חובה לבחור שעה"),
  location: optionalText,
  capacity: capacityField,
  grow_link: optionalText,
  remind_day_before: z.boolean(),
  remind_hour_before: z.boolean(),
});

export type EventDesignInput = z.input<typeof designSchema>;

/** שמירה אחת לכל שלוש הלשוניות — כפתור "שמור" יחיד, ולא שמירה לכל שדה. */
export async function saveEventDesignAction(
  id: string,
  input: EventDesignInput
): Promise<EventResult> {
  await verifyTeamMember();

  const parsed = designSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const startsAt = startsAtFrom(parsed.data.date, parsed.data.time);
  if ("error" in startsAt) return { ok: false, error: startsAt.error };

  const d = parsed.data;

  // העמודות נכתבות אחת-אחת ולא בפריסה של parsed.data: date ו-time אינם
  // עמודות אלא הקלט שממנו starts_at נגזר, ופריסה עיוורת הייתה שולחת אותם
  // למסד ונכשלת רק בזמן ריצה.
  const { error } = await supabaseAdmin()
    .from("events")
    .update({
      name: d.name,
      subtitle: d.subtitle,
      form_description: d.form_description,
      button_text: d.button_text,
      header_image_url: d.header_image_url,
      show_datetime: d.show_datetime,
      show_capacity: d.show_capacity,
      thankyou_title: d.thankyou_title,
      thankyou_text: d.thankyou_text,
      thankyou_show_calendar: d.thankyou_show_calendar,
      thankyou_show_image: d.thankyou_show_image,
      custom_fields: d.custom_fields as EventCustomField[],
      starts_at: startsAt.toISOString(),
      location: d.location,
      capacity: d.capacity,
      grow_link: d.grow_link,
      remind_day_before: d.remind_day_before,
      remind_hour_before: d.remind_hour_before,
    })
    .eq("id", id);

  if (error) return { ok: false, error: explain(error) };

  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  return { ok: true };
}

export async function uploadEventImageAction(formData: FormData): Promise<UploadResult> {
  await verifyTeamMember();

  const file = formData.get("image");
  if (!(file instanceof File)) return { ok: false, error: "לא נבחר קובץ" };

  try {
    return { ok: true, url: await uploadPublicImage(file, "events") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── מסך הניהול ─────────────────────────────────────────────────────────────

/**
 * סימון ידני כשילמה — הגיבוי לגרואו.
 *
 * כל עוד אין webhook מגרואו (שלב 6), זו הדרך היחידה לסגור את המעגל: בעלת
 * העסק רואה תשלום בגרואו ומסמנת כאן. paid_at נכתב רק בפעם הראשונה, כדי
 * שסימון חוזר לא ידחוף את התאריך קדימה.
 */
export async function markPaidAction(formData: FormData): Promise<void> {
  await verifyTeamMember();

  const registrationId = String(formData.get("registration_id") ?? "");
  const eventId = String(formData.get("event_id") ?? "");
  if (!registrationId) return;

  await supabaseAdmin()
    .from("event_registrations")
    .update({ stage: "paid", paid_at: new Date().toISOString() })
    .eq("id", registrationId)
    .neq("stage", "paid");

  if (eventId) revalidatePath(`/events/${eventId}`);
  revalidatePath("/events");
  revalidatePath("/");
}
