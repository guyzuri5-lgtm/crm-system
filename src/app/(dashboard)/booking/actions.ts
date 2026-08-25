"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { cancelBooking } from "@/lib/booking/create";
import { clockToMinutes } from "@/lib/booking/timezone";
import { BOOKING_LOCATIONS } from "@/lib/supabase/database.types";
import { STATUS_COLORS, type StatusColor } from "@/lib/status-colors";

// כל הפעולות של לשונית "פגישות" בדשבורד. verifyTeamMember בראש כל אחת — Server
// Action הוא endpoint לכל דבר, וההגנה של proxy.ts על הנתיב אינה חלה עליו.

const slugField = z
  .string()
  .trim()
  .min(1, "חובה למלא כתובת לקישור")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "הכתובת יכולה להכיל אותיות אנגליות קטנות, ספרות ומקפים בלבד");

const eventTypeFields = {
  slug: slugField,
  name: z.string().trim().min(1, "חובה למלא שם לסוג הפגישה").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  // שתי העמודות נשמרות ב-DB, אבל הטופס חושף שדה אחד ("הפסקה בין פגישות")
  // וכותב אותו לשתיהן. ראו readEventTypeForm להסבר למה זה חייב להיות סימטרי.
  buffer_before_minutes: z.coerce.number().int().min(0).max(240),
  buffer_after_minutes: z.coerce.number().int().min(0).max(240),
  min_notice_hours: z.coerce.number().int().min(0).max(720),
  max_days_ahead: z.coerce.number().int().min(1).max(365),
  slot_interval_minutes: z.coerce.number().int().min(5).max(120),
  location: z.enum(BOOKING_LOCATIONS),
  location_details: z.string().trim().max(300).optional().nullable(),
  color: z.enum(STATUS_COLORS as [StatusColor, ...StatusColor[]]),
  set_contact_status: z.string().trim().max(80).optional().nullable(),
  active: z.coerce.boolean(),
};

function readEventTypeForm(formData: FormData) {
  return {
    slug: formData.get("slug"),
    name: formData.get("name"),
    description: formData.get("description") || null,
    duration_minutes: formData.get("duration_minutes"),
    // הפסקה אחת שנכתבת לשני הצדדים. אסימטריה כאן היא באג ולא גמישות:
    // הבאפר מורח סביב הפגישה ה*חדשה* בלבד, אז אם הצד הקדמי הוא 0, פגישה
    // חדשה יכולה להתחיל בדיוק ברגע שפגישה קיימת נגמרה — בלי שום הפסקה.
    // רק ערך זהה בשני הצדדים מבטיח מרווח אמיתי בין שתי פגישות.
    buffer_before_minutes: formData.get("buffer_minutes") || 0,
    buffer_after_minutes: formData.get("buffer_minutes") || 0,
    min_notice_hours: formData.get("min_notice_hours") || 0,
    max_days_ahead: formData.get("max_days_ahead") || 30,
    slot_interval_minutes: formData.get("slot_interval_minutes") || 15,
    location: formData.get("location"),
    location_details: formData.get("location_details") || null,
    color: formData.get("color") || "blue",
    // <select> ריק שולח מחרוזת ריקה; ב-DB זה מפתח זר, ולכן null ולא "".
    set_contact_status: formData.get("set_contact_status") || null,
    active: formData.get("active") === "on",
  };
}

function fail(error: z.ZodError): never {
  throw new Error(error.issues.map((issue) => issue.message).join(", "));
}

/**
 * "העמודה לא קיימת" — כלומר הקוד עלה אבל המיגרציה שמוסיפה אותה עוד לא הורצה.
 *
 * PGRST204 הוא הקוד ש-PostgREST מחזיר על *כתיבה* לעמודה שאינה בסכימה, במקביל
 * ל-PGRST205 של טבלה חסרה שמטופל ב-lib/booking/data.ts. ההודעה הגולמית
 * ("Could not find the 'host_name' column ... in the schema cache") לא אומרת
 * למי שנתקל בה מה לעשות.
 */
function assertBookingColumns(error: { code?: string; message: string } | null): void {
  if (error?.code === "PGRST204") {
    throw new Error(
      "חסרות עמודות במסד הנתונים. יש להריץ את supabase/migrations/0008_booking_host_and_calendar.sql ב-SQL editor של Supabase."
    );
  }
}

export async function createEventTypeAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = z.object(eventTypeFields).safeParse(readEventTypeForm(formData));
  if (!parsed.success) fail(parsed.error);

  const { error } = await supabaseAdmin().from("booking_event_types").insert(parsed.data);
  if (error) {
    throw new Error(
      error.code === "23505" ? "כבר קיים סוג פגישה עם אותה כתובת קישור" : error.message
    );
  }

  revalidatePath("/booking");
}

export async function updateEventTypeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("חסר מזהה");

  const parsed = z.object(eventTypeFields).safeParse(readEventTypeForm(formData));
  if (!parsed.success) fail(parsed.error);

  const { error } = await supabaseAdmin()
    .from("booking_event_types")
    .update(parsed.data)
    .eq("id", id);
  if (error) {
    throw new Error(
      error.code === "23505" ? "כבר קיים סוג פגישה עם אותה כתובת קישור" : error.message
    );
  }

  revalidatePath("/booking");
}

export async function deleteEventTypeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("booking_event_types").delete().eq("id", id);
  if (error) {
    // bookings.event_type_id הוא ON DELETE RESTRICT בכוונה — היסטוריית הפגישות
    // לא נמחקת בטעות יחד עם סוג הפגישה.
    throw new Error(
      error.code === "23503"
        ? "אי אפשר למחוק סוג פגישה שכבר נקבעו בו פגישות. כבו אותו במקום זאת — הקישור יפסיק לעבוד וההיסטוריה תישמר."
        : error.message
    );
  }

  revalidatePath("/booking/upcoming");
}

export async function cancelBookingAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { data: booking, error } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!booking) throw new Error("הפגישה לא נמצאה");

  const result = await cancelBooking(booking, "team");
  if (!result.ok) throw new Error(result.error ?? "ביטול הפגישה נכשל");

  revalidatePath("/booking");
}

// ── שעות זמינות ─────────────────────────────────────────────────────────

export async function addAvailabilityAction(formData: FormData) {
  await verifyTeamMember();

  const weekday = Number(formData.get("weekday"));
  const start = clockToMinutes(String(formData.get("start_time") ?? ""));
  const end = clockToMinutes(String(formData.get("end_time") ?? ""));
  // מחרוזת ריקה = ברירת המחדל הגלובלית, שחלה על כל סוג פגישה בלי שעות משלו.
  const eventTypeId = String(formData.get("event_type_id") ?? "") || null;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new Error("יום לא תקין");
  }
  if (start === null || end === null) throw new Error("שעה לא תקינה");
  if (end <= start) throw new Error("שעת הסיום חייבת להיות אחרי שעת ההתחלה");

  const { error } = await supabaseAdmin().from("booking_availability").insert({
    event_type_id: eventTypeId,
    weekday,
    start_minute: start,
    end_minute: end,
  });
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

export async function deleteAvailabilityAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("booking_availability").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

// ── חריגות זמינות לתאריך (היומן הידני) ─────────────────────────────────

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function readDate(formData: FormData): string {
  const value = String(formData.get("override_date") ?? "").trim();
  if (!DATE_KEY.test(value)) throw new Error("תאריך לא תקין");
  return value;
}

/** הוספת חלון שעות לתאריך מסוים. */
export async function addDateWindowAction(formData: FormData) {
  await verifyTeamMember();

  const date = readDate(formData);
  const start = clockToMinutes(String(formData.get("start_time") ?? ""));
  const end = clockToMinutes(String(formData.get("end_time") ?? ""));
  if (start === null || end === null) throw new Error("שעה לא תקינה");
  if (end <= start) throw new Error("שעת הסיום חייבת להיות אחרי שעת ההתחלה");

  const db = supabaseAdmin();
  // "לא זמין" ו"חלון שעות" הם מצבים סותרים על אותו תאריך. הוספת שעות
  // מבטלת את סימון אי-הזמינות, אחרת האינדקס היחיד היה נופל על ההוספה הבאה.
  await db
    .from("booking_date_overrides")
    .delete()
    .eq("override_date", date)
    .is("event_type_id", null)
    .is("start_minute", null);

  const { error } = await db.from("booking_date_overrides").insert({
    override_date: date,
    start_minute: start,
    end_minute: end,
  });
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

/** סימון יום שלם כלא זמין, גם אם הוא יום עבודה רגיל. */
export async function setDateUnavailableAction(formData: FormData) {
  await verifyTeamMember();

  const date = readDate(formData);
  const db = supabaseAdmin();

  await db.from("booking_date_overrides").delete().eq("override_date", date).is("event_type_id", null);
  const { error } = await db.from("booking_date_overrides").insert({
    override_date: date,
    start_minute: null,
    end_minute: null,
  });
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

/** החזרת תאריך לברירת המחדל השבועית — מחיקת כל החריגות שלו. */
export async function clearDateOverridesAction(formData: FormData) {
  await verifyTeamMember();

  const date = readDate(formData);
  const { error } = await supabaseAdmin()
    .from("booking_date_overrides")
    .delete()
    .eq("override_date", date)
    .is("event_type_id", null);
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

export async function deleteDateWindowAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("booking_date_overrides").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

// ── חסימות ידניות ───────────────────────────────────────────────────────

/**
 * הטופס שולח שעה מקומית מ-<input type="datetime-local"> ("2026-08-24T14:00"),
 * בלי אזור זמן. הפרשנות הנכונה היא אזור הזמן של המערכת, ולכן ההמרה נעשית כאן
 * דרך zonedTimeToUtc ולא ב-new Date(value) — שהיה מפרש לפי אזור הזמן של השרת
 * (ב-Vercel: UTC), ומזיז כל חסימה בשעתיים.
 */
export async function addBlackoutAction(formData: FormData) {
  await verifyTeamMember();

  const { getBookingSettings } = await import("@/lib/booking/data");
  const { zonedTimeToUtc } = await import("@/lib/booking/timezone");
  const settings = await getBookingSettings();

  function toInstant(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    return zonedTimeToUtc(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]) * 60 + Number(match[5]),
      settings.timezone
    );
  }

  const start = toInstant(String(formData.get("starts_at") ?? ""));
  const end = toInstant(String(formData.get("ends_at") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!start || !end) throw new Error("תאריך או שעה לא תקינים");
  if (end.getTime() <= start.getTime()) throw new Error("הסיום חייב להיות אחרי ההתחלה");

  const { error } = await supabaseAdmin().from("booking_blackouts").insert({
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason,
  });
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

export async function deleteBlackoutAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("booking_blackouts").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/booking/calendar");
}

// ── הגדרות כלליות ───────────────────────────────────────────────────────

const settingsSchema = z.object({
  timezone: z.string().trim().min(1).max(60),
  calendar_id: z.string().trim().min(1).max(200),
  brand_name: z.string().trim().min(1).max(120),
  busy_calendar_ids: z.array(z.string().trim().min(1)),
  block_all_day_events: z.coerce.boolean(),
  host_name: z.string().trim().max(120).nullable(),
  host_title: z.string().trim().max(160).nullable(),
});

export async function saveSettingsAction(formData: FormData) {
  await verifyTeamMember();

  const raw = String(formData.get("busy_calendar_ids") ?? "");
  const parsed = settingsSchema.safeParse({
    timezone: formData.get("timezone"),
    calendar_id: formData.get("calendar_id"),
    brand_name: formData.get("brand_name"),
    // שורה לכל יומן בתיבת טקסט — סינון שורות ריקות כדי ש-freeBusy לא יקבל "".
    busy_calendar_ids: raw
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
    block_all_day_events: formData.get("block_all_day_events") === "on",
    // שדה ריק הוא "אין", ולא מחרוזת ריקה — דף ההזמנה בודק null כדי להחליט
    // אם להציג את כרטיס המארח בכלל.
    host_name: String(formData.get("host_name") ?? "").trim() || null,
    host_title: String(formData.get("host_title") ?? "").trim() || null,
  });
  if (!parsed.success) fail(parsed.error);

  // ולידציה של אזור הזמן מול Intl: ערך שגוי כאן היה מפיל כל חישוב סלוטים
  // בכל הדפים, כולל הציבורי.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.data.timezone });
  } catch {
    throw new Error(`אזור זמן לא מוכר: ${parsed.data.timezone}`);
  }

  const { error } = await supabaseAdmin()
    .from("booking_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", true);
  assertBookingColumns(error);
  if (error) throw error;

  revalidatePath("/booking/settings");
  revalidatePath("/booking");
  revalidatePath("/book", "layout");
}

// ── תמונת המארח ─────────────────────────────────────────────────────────

const HOST_PHOTO_BUCKET = "booking-assets";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// רשימה סגורה ולא בדיקת "image/*": הדפדפן קובע את ה-type מהסיומת, ולכן הוא
// קלט של המשתמש לכל דבר. הסיומת נגזרת מכאן ולא משם ה-קובץ המקורי, כדי
// שקובץ בשם ‎photo.svg‎ לא יגיע לבאקט ציבורי כ-SVG (שהוא HTML שרץ).
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * מסלול הקובץ בבאקט, ולא רק שם קבוע: הבאקט ציבורי ונקרא דרך CDN, ותמונה
 * שנדרסת באותה כתובת תמשיך להיות מוגשת מהמטמון גם אחרי ההחלפה. שם חדש
 * בכל העלאה הוא מה שמבטיח שהלקוח יראה את התמונה החדשה מיד.
 */
export async function uploadHostPhotoAction(formData: FormData) {
  await verifyTeamMember();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) throw new Error("לא נבחר קובץ");

  const extension = PHOTO_TYPES[file.type];
  if (!extension) throw new Error("אפשר להעלות JPG, PNG או WEBP בלבד");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(`התמונה גדולה מדי (${Math.round(file.size / 1024)}KB). המקסימום הוא 2MB.`);
  }

  const db = supabaseAdmin();
  const path = `host/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await db.storage
    .from(HOST_PHOTO_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type });
  if (uploadError) {
    // הבאקט נוצר ב-0008_booking_host_and_calendar.sql. ההודעה הגולמית
    // ("Bucket not found") לא אומרת למי שנתקל בה מה חסר.
    throw new Error(
      /bucket/i.test(uploadError.message)
        ? "אחסון התמונות לא הוגדר. יש להריץ את supabase/migrations/0008_booking_host_and_calendar.sql."
        : uploadError.message
    );
  }

  const {
    data: { publicUrl },
  } = db.storage.from(HOST_PHOTO_BUCKET).getPublicUrl(path);

  const previous = await currentHostPhotoPath();

  const { error } = await db
    .from("booking_settings")
    .update({ host_photo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", true);
  assertBookingColumns(error);
  if (error) throw error;

  // המחיקה אחרי העדכון ולא לפניו: אם השמירה נכשלה, עדיף להשאיר קובץ יתום
  // בבאקט מאשר להישאר עם כתובת בהגדרות שמצביעה על קובץ שכבר נמחק.
  if (previous) await db.storage.from(HOST_PHOTO_BUCKET).remove([previous]);

  revalidatePath("/booking/settings");
  revalidatePath("/book", "layout");
}

export async function removeHostPhotoAction() {
  await verifyTeamMember();

  const db = supabaseAdmin();
  const previous = await currentHostPhotoPath();

  const { error } = await db
    .from("booking_settings")
    .update({ host_photo_url: null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw error;

  if (previous) await db.storage.from(HOST_PHOTO_BUCKET).remove([previous]);

  revalidatePath("/booking/settings");
  revalidatePath("/book", "layout");
}

/** הנתיב בתוך הבאקט של התמונה השמורה כרגע, אם היא בכלל שלנו. */
async function currentHostPhotoPath(): Promise<string | null> {
  const { getBookingSettings } = await import("@/lib/booking/data");
  const url = (await getBookingSettings()).host_photo_url;
  if (!url) return null;
  const marker = `/${HOST_PHOTO_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}
