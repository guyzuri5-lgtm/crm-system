import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BookingAvailability,
  BookingBlackout,
  BookingDateOverride,
  BookingEventType,
  BookingSettings,
} from "@/lib/supabase/database.types";

/**
 * קריאות ה-DB של מערכת הזימון. cache() של React מאחד קריאות חוזרות בתוך אותו
 * render pass — דף ההזמנה ניגש להגדרות גם ברכיב וגם ב-API של הסלוטים.
 */

/**
 * "הטבלה לא קיימת" — כלומר הקוד עלה אבל
 * supabase/migrations/0005_booking.sql עוד לא הורץ. ההודעה הגולמית שחוזרת
 * ("Could not find the table ... in the schema cache") לא אומרת למי שנתקל בה מה לעשות.
 *
 * שני קודים ולא אחד: supabase-js מדבר עם PostgREST, וטבלה חסרה מוחזרת ממנו
 * כ-PGRST205 — לא כ-42P01 של פוסטגרס עצמו. בדיקה של 42P01 בלבד פשוט לא
 * הייתה נדלקת אף פעם.
 */
function assertMigrated(error: { code?: string; message: string } | null): void {
  if (error?.code === "42P01" || error?.code === "PGRST205") {
    throw new Error(
      "טבלאות מערכת הזימון לא קיימות. יש להריץ את supabase/migrations/0005_booking.sql ב-SQL editor של Supabase (ראו README, סעיף \"יומן גוגל\")."
    );
  }
}

const FALLBACK_SETTINGS: BookingSettings = {
  id: true,
  timezone: "Asia/Jerusalem",
  calendar_id: "primary",
  busy_calendar_ids: [],
  brand_name: "קביעת פגישה",
  block_all_day_events: false,
  host_name: null,
  host_title: null,
  host_photo_url: null,
  updated_at: new Date().toISOString(),
};

/**
 * שורת ההגדרות היחידה. אם המיגרציה 0005 עוד לא הורצה, מוחזרות ברירות מחדל
 * במקום להפיל את הדף — כך שהתקלה מתגלה כטקסט בדשבורד ולא כמסך שגיאה ללקוח.
 */
export const getBookingSettings = cache(async (): Promise<BookingSettings> => {
  const { data, error } = await supabaseAdmin()
    .from("booking_settings")
    .select("*")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[booking] failed to read booking_settings:", error.message);
    return FALLBACK_SETTINGS;
  }
  return data;
});

export const listEventTypes = cache(async (): Promise<BookingEventType[]> => {
  const { data, error } = await supabaseAdmin()
    .from("booking_event_types")
    .select("*")
    .order("sort_order")
    .order("created_at");
  assertMigrated(error);
  if (error) throw error;
  return data ?? [];
});

/** סוג פגישה לפי ה-slug שבקישור. מחזיר null גם לסוג כבוי, כדי שקישור ישן ייתן 404. */
export async function getActiveEventTypeBySlug(slug: string): Promise<BookingEventType | null> {
  const { data, error } = await supabaseAdmin()
    .from("booking_event_types")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  assertMigrated(error);
  if (error) throw error;
  return data ?? null;
}

export async function listAvailability(): Promise<BookingAvailability[]> {
  const { data, error } = await supabaseAdmin()
    .from("booking_availability")
    .select("*")
    .order("weekday")
    .order("start_minute");
  assertMigrated(error);
  if (error) throw error;
  return data ?? [];
}

/**
 * השעות שבתוקף עבור סוג פגישה: אם הוגדרו לו שעות משלו הן דורסות את הגלובליות
 * לחלוטין, ולא מתווספות אליהן. הבחירה הזו מכוונת — "לסוג הזה רק שלישי בערב"
 * הוא הדבר שמנסים לבטא, ואיחוד היה מוסיף את כל שבוע העבודה הרגיל.
 */
export async function resolveAvailability(
  eventTypeId: string
): Promise<BookingAvailability[]> {
  const all = await listAvailability();
  const specific = all.filter((row) => row.event_type_id === eventTypeId);
  return specific.length > 0 ? specific : all.filter((row) => row.event_type_id === null);
}

/**
 * חריגות זמינות לתאריכים ספציפיים, בטווח נתון (כולל שני הקצוות).
 *
 * הטווח מסונן על תאריכים ולא על רגעים: override_date הוא date, ולא שייך
 * לאזור זמן כלשהו.
 */
export async function listDateOverrides(
  fromDateKey?: string,
  toDateKey?: string
): Promise<BookingDateOverride[]> {
  let query = supabaseAdmin()
    .from("booking_date_overrides")
    .select("*")
    .order("override_date")
    .order("start_minute", { nullsFirst: true });
  if (fromDateKey) query = query.gte("override_date", fromDateKey);
  if (toDateKey) query = query.lte("override_date", toDateKey);
  const { data, error } = await query;
  assertMigrated(error);
  if (error) throw error;
  return data ?? [];
}

/**
 * החריגות שבתוקף לסוג פגישה, מקובצות לפי תאריך.
 *
 * אותו כלל דריסה כמו בשעות השבועיות: אם לסוג הפגישה יש חריגות משלו על תאריך
 * מסוים, הן מחליפות את החריגות הכלליות של אותו תאריך — לא מתווספות אליהן.
 */
export function groupOverridesByDate(
  overrides: BookingDateOverride[],
  eventTypeId: string
): Map<string, BookingDateOverride[]> {
  const byDate = new Map<string, BookingDateOverride[]>();
  for (const row of overrides) {
    const rows = byDate.get(row.override_date) ?? [];
    rows.push(row);
    byDate.set(row.override_date, rows);
  }
  for (const [date, rows] of byDate) {
    const specific = rows.filter((row) => row.event_type_id === eventTypeId);
    byDate.set(date, specific.length > 0 ? specific : rows.filter((row) => row.event_type_id === null));
  }
  return byDate;
}

export async function listBlackouts(from?: Date, to?: Date): Promise<BookingBlackout[]> {
  let query = supabaseAdmin().from("booking_blackouts").select("*").order("starts_at");
  // חסימה נחשבת רלוונטית אם היא *חופפת* לטווח, לא אם היא כלולה בו — חסימה
  // שהתחילה לפני תחילת החלון וממשיכה לתוכו חייבת להיספר.
  if (to) query = query.lt("starts_at", to.toISOString());
  if (from) query = query.gt("ends_at", from.toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * פגישות פעילות שכבר נקבעו דרך המערכת, כטווחי "תפוס".
 *
 * יש כאן כפילות מכוונת מול freeBusy של גוגל: פגישה שנקבעה כבר יושבת ביומן,
 * אז ברוב המקרים שני המקורות מחזירים אותו טווח. הכפילות היא מה שמאפשר
 * למערכת לתפקד נכון גם כשהיומן עדיין לא חובר, וגם אם יצירת אירוע נכשלה
 * אחרי שהפגישה כבר נשמרה.
 */
export async function listConfirmedBookings(from: Date, to: Date) {
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select("id, starts_at, ends_at")
    .eq("status", "confirmed")
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error) throw error;
  return data ?? [];
}
