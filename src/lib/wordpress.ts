import "server-only";

import { after } from "next/server";
import { supabaseAdmin } from "./supabase/admin";
import { countStages, EVENT_TIMEZONE } from "./events";
import { appUrl } from "./booking/create";
import { utcToZonedParts } from "./booking/timezone";
import type { CourseRow, EventRow } from "./supabase/database.types";

/**
 * סנכרון אירועים וקורסים לאתר הוורדפרס (spiritualguy.co.il), כיוון אחד:
 * ה-CRM הוא המקור, והאתר מציג. סוגי התוכן באתר הם event ו-course, והשדות
 * שלהם נכתבים תחת acf.
 *
 * ── שלושה כללים שהקוד כאן שומר עליהם ──
 * 1. **לא דורסים מה שגיא מנהל באתר.** נשלחים רק שדות שיש להם ערך ב-CRM:
 *    content ריק לא נשלח, התמונה הראשית לא נשלחת אף פעם, וגם course_sales_page
 *    לא — הוא שייך לאתר.
 * 2. **פעיל = מפורסם.** active=true → publish, אחרת draft (החלטה מ-14.10.26).
 * 3. **האתר לא מעכב ולא מפיל את ה-CRM.** כל קריאה מוגבלת בזמן, שום דבר כאן
 *    לא זורק החוצה, וכישלון משאיר את wp_sync_pending דלוק — הקרון ינסה שוב.
 *
 * ── קישור הרכישה ──
 * event_payment_url ו-course_payment_url מפנים לדף ההרשמה של ה-CRM ולא
 * ישירות לגרואו. מי שמשלם בגרואו בלי לעבור בטופס לא מוכר ל-CRM, ואז הוא לא
 * מקבל את מייל הגישה או את התזכורות. הטופס הוא מה שמבטיח שהתשלום ישויך.
 */

export type WordPressKind = "event" | "course";

const TABLE = { event: "events", course: "courses" } as const;

/** כמה זמן מחכים לאתר. מעבר לזה — נכשל, והקרון ינסה שוב. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * הקרון לא נוגע בבקשה צעירה מזה: סביר שהסנכרון שהיא עצמה הפעילה (after)
 * עדיין רץ, ושני סנכרונים במקביל לאירוע בלי פוסט היו יוצרים שני פוסטים.
 */
const RETRY_AFTER_MS = 2 * 60_000;

// ── בקשה לסנכרון ───────────────────────────────────────────────────────────

/** העמודות שמסמנות "צריך לדחוף לאתר". נכנסות לאותו update של השמירה עצמה. */
export function wpSyncRequest(now: Date = new Date()) {
  return { wp_sync_pending: true, wp_sync_requested_at: now.toISOString() };
}

/** מריץ את הסנכרון אחרי שהתשובה כבר יצאה למשתמש (או לגרואו). */
export function scheduleWordPressSync(kind: WordPressKind, id: string): void {
  after(() => syncToWordPress(kind, id));
}

/**
 * מסמן ומתזמן, לשימוש במקומות שאינם השמירה עצמה — תשלום, כיבוי והדלקה.
 * לא זורק: כישלון כאן הוא לכל היותר עדכון מאוחר של האתר.
 */
export async function requestWordPressSync(kind: WordPressKind, id: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from(TABLE[kind])
    .update(wpSyncRequest())
    .eq("id", id);
  if (error) console.error(`[wordpress] סימון ${kind} ${id} לסנכרון נכשל:`, error.message);
  scheduleWordPressSync(kind, id);
}

// ── הסנכרון עצמו ───────────────────────────────────────────────────────────

export type SyncOutcome = { ok: true; postId: number } | { ok: false; error: string };

/**
 * דוחף שורה אחת לאתר: יוצר פוסט אם אין לה wp_post_id, ומעדכן אם יש.
 * לעולם לא זורק — התוצאה נכתבת לשורה ומוחזרת.
 */
export async function syncToWordPress(kind: WordPressKind, id: string): Promise<SyncOutcome> {
  const db = supabaseAdmin();

  try {
    const config = wordPressConfig();

    const row = await loadRow(kind, id);
    if (!row) return { ok: false, error: "השורה לא נמצאה" };
    const requestedAt = row.wp_sync_requested_at;

    if (!config) {
      const error = "חסרים WP_URL / WP_USERNAME / WP_APP_PASSWORD בסביבה";
      await recordFailure(kind, id, error);
      return { ok: false, error };
    }

    const body = kind === "event" ? await eventPayload(row as EventRow) : coursePayload(row as CourseRow);

    const existing = row.wp_post_id;
    const path = existing ? `/wp-json/wp/v2/${kind}/${existing}` : `/wp-json/wp/v2/${kind}`;
    const response = await wpFetch(config, path, body);
    const postId = Number((response as { id?: unknown }).id);
    if (!Number.isFinite(postId) || postId <= 0) {
      throw new Error("האתר ענה בלי מזהה פוסט");
    }

    if (!existing) {
      // .is(null) כדי שסנכרון מקביל שכבר יצר פוסט לא יידרס. אם זה קרה,
      // נוצר פוסט כפול באתר — עדיף שזה ייראה בשגיאה מאשר שייעלם.
      const { data: linked, error } = await db
        .from(TABLE[kind])
        .update({ wp_post_id: postId })
        .eq("id", id)
        .is("wp_post_id", null)
        .select("id");
      if (error) throw new Error(error.message);
      if (!linked?.length) {
        throw new Error(`נוצר באתר פוסט כפול (${postId}) — כדאי למחוק אותו שם`);
      }
    }

    // הדגל יורד רק אם לא נשמר שינוי חדש בזמן שהסנכרון רץ. אחרת הוא נשאר
    // דלוק, והסנכרון של השמירה החדשה (או הקרון) ישלח את הגרסה העדכנית.
    let done = db
      .from(TABLE[kind])
      .update({ wp_sync_pending: false, wp_sync_error: null, wp_synced_at: new Date().toISOString() })
      .eq("id", id);
    done = requestedAt ? done.eq("wp_sync_requested_at", requestedAt) : done.is("wp_sync_requested_at", null);
    const { error: doneError } = await done;
    if (doneError) console.error(`[wordpress] עדכון מצב ${kind} ${id} נכשל:`, doneError.message);

    return { ok: true, postId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[wordpress] סנכרון ${kind} ${id} נכשל:`, error);
    await recordFailure(kind, id, error);
    return { ok: false, error };
  }
}

/**
 * הרשת שמתחת: הקרון דוחף כל מה שנשאר תלוי. סדרתי ולא במקביל — ורדפרס
 * באחסון משותף לא אוהב פרצים, וממילא מדובר בשורות בודדות.
 */
export async function runWordPressSync(
  now: Date,
  budgetMs: number
): Promise<{ synced: number; failed: number }> {
  const result = { synced: 0, failed: 0 };
  if (!wordPressConfig()) return result;

  const deadline = Date.now() + budgetMs;
  const cutoff = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const db = supabaseAdmin();

  for (const kind of ["event", "course"] as const) {
    const { data, error } = await db
      .from(TABLE[kind])
      .select("id")
      .eq("wp_sync_pending", true)
      .or(`wp_sync_requested_at.is.null,wp_sync_requested_at.lt.${cutoff}`)
      .order("wp_sync_requested_at")
      .limit(20);
    if (error) {
      console.error(`[wordpress] שליפת ${kind} לסנכרון נכשלה:`, error.message);
      continue;
    }
    for (const { id } of data ?? []) {
      if (Date.now() + REQUEST_TIMEOUT_MS > deadline) return result;
      const outcome = await syncToWordPress(kind, id);
      if (outcome.ok) result.synced += 1;
      else result.failed += 1;
    }
  }
  return result;
}

// ── מה נשלח ────────────────────────────────────────────────────────────────

type Payload = {
  title: string;
  status: "publish" | "draft";
  content?: string;
  acf: Record<string, string | number>;
};

/** שדה נכנס רק אם יש לו ערך — כך ריק ב-CRM לא מוחק את מה שכתוב באתר. */
function withValues(fields: Record<string, string | number | null | undefined>) {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out;
}

function base(row: EventRow | CourseRow): Omit<Payload, "acf"> {
  const content = row.description?.trim();
  return {
    title: row.name,
    status: row.active ? "publish" : "draft",
    ...(content ? { content } : {}),
  };
}

async function eventPayload(event: EventRow): Promise<Payload> {
  let seatsLeft: number | null = null;
  if (event.capacity !== null) {
    const counts = await countStages(event.id);
    seatsLeft = Math.max(0, event.capacity - counts.paid);
  }

  return {
    ...base(event),
    acf: withValues({
      event_start: wpDateTime(event.starts_at),
      event_end: event.ends_at ? wpDateTime(event.ends_at) : null,
      event_location: event.location,
      event_price: event.price,
      event_capacity: event.capacity,
      event_seats_left: seatsLeft,
      event_payment_url: `${appUrl()}/event/${event.slug}`,
      event_crm_id: event.id,
      event_short: event.short_description,
    }),
  };
}

function coursePayload(course: CourseRow): Payload {
  return {
    ...base(course),
    acf: withValues({
      course_price: course.price,
      course_payment_url: `${appUrl()}/course/${course.slug}`,
      course_crm_id: course.id,
      course_short: course.short_description,
    }),
  };
}

/** "Y-m-d H:i:s" בשעון ישראל — כך האתר מציג את מה שגיא הקליד. */
export function wpDateTime(iso: string): string {
  const p = utcToZonedParts(new Date(iso), EVENT_TIMEZONE);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(Math.floor(p.minutes / 60))}:${two(p.minutes % 60)}:00`;
}

// ── תקשורת עם האתר ─────────────────────────────────────────────────────────

interface WordPressConfig {
  url: string;
  authorization: string;
}

function wordPressConfig(): WordPressConfig | null {
  const url = process.env.WP_URL?.trim().replace(/\/+$/, "");
  const user = process.env.WP_USERNAME?.trim();
  const password = process.env.WP_APP_PASSWORD?.trim();
  if (!url || !user || !password) return null;
  return {
    url,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  };
}

async function wpFetch(config: WordPressConfig, path: string, body: Payload): Promise<unknown> {
  const response = await fetch(`${config.url}${path}`, {
    method: "POST",
    headers: { Authorization: config.authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // דף שגיאה של השרת או של חומת אש — ההודעה נבנית מהסטטוס.
  }

  if (!response.ok) {
    const message = (json as { message?: unknown } | null)?.message;
    const detail = typeof message === "string" ? message : text.slice(0, 200);
    if (response.status === 404 && path.match(/\/\d+$/)) {
      throw new Error(`הפוסט ${path.split("/").pop()} לא נמצא באתר (${detail})`);
    }
    throw new Error(`האתר החזיר ${response.status}: ${detail}`);
  }
  return json;
}

// ── מסד ────────────────────────────────────────────────────────────────────

async function loadRow(kind: WordPressKind, id: string): Promise<EventRow | CourseRow | null> {
  const { data, error } = await supabaseAdmin().from(TABLE[kind]).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as EventRow | CourseRow | null;
}

async function recordFailure(kind: WordPressKind, id: string, error: string): Promise<void> {
  const { error: writeError } = await supabaseAdmin()
    .from(TABLE[kind])
    .update({ wp_sync_pending: true, wp_sync_error: error.slice(0, 500) })
    .eq("id", id);
  if (writeError) console.error(`[wordpress] רישום השגיאה נכשל:`, writeError.message);
}
