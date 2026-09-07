import "server-only";

import { cache } from "react";
import {
  buildIcs as buildIcsFor,
  googleCalendarUrl as googleCalendarUrlFor,
  type CalendarEntry,
} from "./calendar-links";
import { supabaseAdmin } from "./supabase/admin";
import type { EventRow } from "./supabase/database.types";

/**
 * שכבת הנתונים והלוגיקה של האירועים — משותפת לדף ההרשמה הציבורי, למסכי
 * הניהול ולמנוע התזכורות.
 *
 * הנרמול של טלפון ואימייל מיובא מ-quiz.ts ולא משוכפל לכאן: "מה נחשב מספר
 * ישראלי תקין" חייב להיות הגדרה אחת. שתי הגדרות שנפרדות עם הזמן פירושן שאותו
 * אדם ייווצר פעמיים ב-contacts — פעם מהשאלון ופעם מדף האירוע.
 */

export const EVENT_TIMEZONE = "Asia/Jerusalem";

/** משך ברירת המחדל בקישורי היומן. לטבלה אין שעת סיום, ולכן הוא תמיד חל. */
const DEFAULT_DURATION_MINUTES = 120;

/**
 * "הטבלה לא קיימת" — כלומר הקוד עלה אבל 0024 עוד לא הורץ. אותו דפוס כמו
 * assertMigrated ב-booking/data.ts, ומאותה סיבה: ההודעה הגולמית של PostgREST
 * לא אומרת למי שנתקל בה מה לעשות.
 */
export function assertEventsMigrated(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    throw new Error(
      "טבלאות האירועים לא קיימות. יש להריץ את supabase/migrations/0024_events.sql ב-SQL editor של Supabase."
    );
  }
}

// ── שליפה ──────────────────────────────────────────────────────────────────

/** האירוע הפעיל שמאחורי /event/{slug}. cache() מאחד את הקריאות באותו render. */
export const getActiveEventBySlug = cache(async (slug: string): Promise<EventRow | null> => {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  assertEventsMigrated(error);
  if (error) throw error;
  return data;
});

export const getEventById = cache(async (id: string): Promise<EventRow | null> => {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  assertEventsMigrated(error);
  if (error) throw error;
  return data;
});

export interface StageCounts {
  interested: number;
  /** נרשמו ולא שילמו */
  registered: number;
  paid: number;
}

/**
 * שלושת המונים של אירוע, בשאילתה אחת.
 *
 * נספרות השורות ולא נשלפות: אירוע עם 300 נרשמים לא צריך להעביר 300 שורות
 * לשרת רק כדי להציג שלושה מספרים.
 */
export async function countStages(eventId: string): Promise<StageCounts> {
  const db = supabaseAdmin();
  const counts = await Promise.all(
    (["interested", "registered", "paid"] as const).map(async (stage) => {
      const { count, error } = await db
        .from("event_registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("stage", stage);
      assertEventsMigrated(error);
      if (error) throw error;
      return count ?? 0;
    })
  );

  return { interested: counts[0], registered: counts[1], paid: counts[2] };
}

/**
 * כמה מקומות נותרו, או null כשאין קיבולת.
 *
 * נספרות רק המשלמות: מקום נתפס בתשלום ולא בהשארת פרטים. אחרת די היה בעשרה
 * טפסים נטושים כדי ש"האירוע מלא" יופיע לכל השאר.
 */
export function spotsLeft(event: EventRow, paid: number): number | null {
  if (event.capacity === null) return null;
  return Math.max(0, event.capacity - paid);
}

// ── קישורי יומן ────────────────────────────────────────────────────────────
//
// המימוש עצמו יושב ב-lib/calendar-links.ts ומשותף עם הפגישות. כאן נשארה רק
// ההמרה מאירוע ל-CalendarEntry — הידע היחיד ששייך לדומיין הזה.

function entryOf(event: EventRow): CalendarEntry {
  const start = new Date(event.starts_at);
  return {
    // "event-" כדי ששני מזהים מטבלאות שונות לא יתנגשו ביומן של אותו אדם.
    uid: `event-${event.id}@crm`,
    title: event.name,
    start,
    end: new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000),
    location: event.location,
    description: event.description,
  };
}

/** "הוספה ליומן Google" — קישור ישיר, בלי OAuth ובלי הרשאות. */
export function googleCalendarUrl(event: EventRow): string {
  return googleCalendarUrlFor(entryOf(event));
}

/** קובץ יומן תקני לכל מי שאינו גוגל — אאוטלוק, אפל, וכל השאר. */
export function buildIcs(event: EventRow): string {
  return buildIcsFor(entryOf(event));
}
