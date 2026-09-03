import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "./supabase/admin";
import { normalizePhone, usableEmail } from "./quiz";
import type { EventRow, EventStage } from "./supabase/database.types";

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

type Db = ReturnType<typeof supabaseAdmin>;

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
 * נספרות השורות ולא נשלפות: אירוע עם 300 נרשמות לא צריך להעביר 300 שורות
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

// ── שלב ההרשמה ─────────────────────────────────────────────────────────────

const STAGE_RANK: Record<EventStage, number> = { interested: 0, registered: 1, paid: 2 };

/**
 * השלב עולה בדרגה בלבד.
 *
 * מי ששילמה וממלאת את הטופס שוב (רענון, לחיצה כפולה, חזרה מגרואו) לא חוזרת
 * להיות "נרשמה ולא שילמה" — אחרת היא הייתה מופיעה ברשימת "דורש טיפול"
 * ומקבלת מסע למתעניינות אחרי שכבר שילמה.
 */
export function strongerStage(current: EventStage | undefined, incoming: EventStage): EventStage {
  if (!current) return incoming;
  return STAGE_RANK[incoming] > STAGE_RANK[current] ? incoming : current;
}

// ── קישורי יומן ────────────────────────────────────────────────────────────

/** ‎"20260903T110000Z"‎ — הפורמט שגוגל ו-ICS מצפים לו. */
function toIcsUtc(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function eventWindow(event: EventRow): { start: Date; end: Date } {
  const start = new Date(event.starts_at);
  return { start, end: new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000) };
}

/** "הוספה ליומן Google" — קישור ישיר, בלי OAuth ובלי הרשאות. */
export function googleCalendarUrl(event: EventRow): string {
  const { start, end } = eventWindow(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name,
    dates: `${toIcsUtc(start)}/${toIcsUtc(end)}`,
  });
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("details", event.description);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * שורה בקובץ ICS. שני דברים שהתקן דורש ושקל לפספס: תווי בקרה בטקסט חופשי
 * חייבים בריחה, ושורה ארוכה מ-75 בתים חייבת קיפול — בלעדיו חלק מהיומנים
 * פשוט חותכים את התיאור באמצע.
 */
function icsLine(name: string, value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

  const line = `${name}:${escaped}`;
  // הקיפול נמדד בבתים ולא בתווים: אות עברית היא שני בתים ב-UTF-8, ומדידה
  // בתווים הייתה מייצרת שורות כפולות מהמותר.
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    // חיתוך בגבול תו ולא בגבול בית — חצי אות עברית אינה UTF-8 תקין.
    let take = Math.min(limit, bytes.length - offset);
    while (take > 1 && (bytes[offset + take] & 0xc0) === 0x80) take -= 1;
    chunks.push(bytes.subarray(offset, offset + take).toString("utf8"));
    offset += take;
    limit = 74; // לשורות ההמשך יש רווח מוביל שנספר גם הוא
  }
  return chunks.join("\r\n ");
}

/** קובץ יומן תקני לכל מי שאינו גוגל — אאוטלוק, אפל, וכל השאר. */
export function buildIcs(event: EventRow): string {
  const { start, end } = eventWindow(event);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CRM//Events//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // ה-UID חייב להיות יציב: יומן שמקבל את אותו קובץ פעמיים מעדכן את האירוע
    // הקיים במקום ליצור כפילות.
    icsLine("UID", `event-${event.id}@crm`),
    icsLine("DTSTAMP", toIcsUtc(new Date())),
    icsLine("DTSTART", toIcsUtc(start)),
    icsLine("DTEND", toIcsUtc(end)),
    icsLine("SUMMARY", event.name),
    ...(event.location ? [icsLine("LOCATION", event.location)] : []),
    ...(event.description ? [icsLine("DESCRIPTION", event.description)] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF ולא \n — התקן דורש זאת, ואאוטלוק באמת נכשל בלעדיו.
  return `${lines.join("\r\n")}\r\n`;
}

// ── כתובת הקישור ───────────────────────────────────────────────────────────

/**
 * הצעת slug משם האירוע.
 *
 * עברית נושרת, ולכן שם עברי לגמרי מחזיר מחרוזת ריקה — במקרה הזה הטופס
 * מבקש מהמשתמש לכתוב כתובת בעצמו במקום לייצר "event-a7f3" חסר משמעות
 * שיישלח אחר כך לקהל.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

// ── איש הקשר ───────────────────────────────────────────────────────────────

export interface RegistrantDetails {
  fullName: string;
  phone: string;
  email: string;
}

/**
 * איתור-או-יצירה של איש קשר, באותו דפוס בדיוק כמו findOrCreateContact
 * ב-src/app/api/webhooks/quiz/route.ts: התאמה לפי טלפון (ייחודי בסכימה) ואז
 * לפי אימייל, בלי לדרוס ערכים קיימים בריקים, ובלי לגעת ב-status — הוא שדה
 * שהצוות מנהל ידנית.
 */
export async function findOrCreateContact(
  db: Db,
  details: RegistrantDetails,
  eventName: string
): Promise<{ id: string } | { error: string }> {
  const email = usableEmail(details.email);
  const phone = normalizePhone(details.phone);
  if (!email && !phone) return { error: "צריך טלפון או אימייל תקין" };

  let existing: { id: string; full_name: string | null; email: string | null; tags: string[] } | null =
    null;

  if (phone) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").eq("phone", phone).maybeSingle();
    if (error) return { error: error.message };
    existing = data;
  }
  if (!existing && email) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").ilike("email", email).limit(1);
    if (error) return { error: error.message };
    existing = data?.[0] ?? null;
  }

  const newTags = [`אירוע: ${eventName}`];

  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), ...newTags]));
    const { error } = await db
      .from("contacts")
      .update({
        full_name: existing.full_name ?? (details.fullName || null),
        email: existing.email ?? email,
        tags,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    return { id: existing.id };
  }

  const { data, error } = await db
    .from("contacts")
    .insert({
      full_name: details.fullName || null,
      phone,
      email,
      source: `אירוע: ${eventName}`,
      tags: newTags,
    })
    .select("id")
    .single();

  if (error) {
    // מרוץ: מישהו יצר את אותו טלפון בין הבדיקה לכתיבה.
    if (error.code === "23505" && phone) {
      const { data: retry } = await db.from("contacts").select("id").eq("phone", phone).maybeSingle();
      if (retry) return { id: retry.id };
    }
    return { error: error.message };
  }
  return { id: data.id };
}
