/**
 * העלאה חוזרת של סרטון שהצליח (גיא, 14.11.2026). הכללים בלבד, בלי מסד — הבדיקות
 * ב-tests/content/reposts.test.mjs. המנוע ב-src/lib/content/reposts.ts.
 *
 *  - סרטון שעבר `threshold` צפיות באינסטגרם עולה שוב `after` ימים/שבועות/חודשים אחרי
 *    העלייה המקורית, באותה שעה, לאותן רשתות (ברירת המחדל: 1000, חודשיים).
 *  - העלאה חוזרת עולה שוב (אחרי אותו זמן) רק אם היא עצמה עברה `repeatThreshold` (2000).
 *  - כל העלאה מולידה לכל היותר העלאה חוזרת אחת.
 * גיא משנה את הכללים במסך ניתוח הרילז; הם נשמרים בהגדרות (content_meta 'settings').
 */

export type RepostUnit = "days" | "weeks" | "months";
export interface RepostRules { threshold: number; after: number; unit: RepostUnit; repeatThreshold: number }

export const DEFAULT_REPOST_RULES: RepostRules = { threshold: 1000, after: 2, unit: "months", repeatThreshold: 2000 };
export const MAX_AFTER: Record<RepostUnit, number> = { days: 365, weeks: 52, months: 12 };
const MIN_THRESHOLD = 100;
const MAX_THRESHOLD = 10_000_000;

/** מה שנשמר תמיד תקין: מספרים שלמים בטווח, והסף להעלאה נוספת לא נמוך מהראשון */
export function normalizeRepostRules(r: Partial<Record<keyof RepostRules, unknown>> | null | undefined): RepostRules {
  const d = DEFAULT_REPOST_RULES;
  const int = (v: unknown, fb: number, min: number, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
  };
  const unit: RepostUnit = r?.unit === "days" || r?.unit === "weeks" || r?.unit === "months" ? r.unit : d.unit;
  const threshold = int(r?.threshold, d.threshold, MIN_THRESHOLD, MAX_THRESHOLD);
  return {
    threshold,
    after: int(r?.after, d.after, 1, MAX_AFTER[unit]),
    unit,
    repeatThreshold: Math.max(threshold, int(r?.repeatThreshold, d.repeatThreshold, MIN_THRESHOLD, MAX_THRESHOLD)),
  };
}

/** הסף לסרטון: מקורי (generation 0) או העלאה חוזרת */
export function thresholdFor(generation: number, rules: RepostRules = DEFAULT_REPOST_RULES) {
  return generation > 0 ? rules.repeatThreshold : rules.threshold;
}

/** "מעל 1000" — 1000 בדיוק לא נחשב */
export function qualifies(views: unknown, generation: number, rules: RepostRules = DEFAULT_REPOST_RULES) {
  const n = Number(views);
  return Number.isFinite(n) && n > thresholdFor(generation, rules);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD + חודשים. יום שאין בחודש היעד (31.12 + 2 = 31.2) נצמד לסוף החודש */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + months;
  const ty = Math.floor(idx / 12);
  const tm = idx % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, last))}`;
}

function shiftDays(date: string, n: number) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM-DD + הזמן שבכללים */
export function addAfter(date: string, after: number, unit: RepostUnit) {
  return unit === "months" ? addMonths(date, after) : shiftDays(date, after * (unit === "weeks" ? 7 : 1));
}

/**
 * מתי ההעלאה החוזרת. `published` הוא השעה המקומית שבה המקור עלה (YYYY-MM-DDTHH:MM).
 * אם היום הזה כבר הגיע (הצפיות הגיעו באיחור) — מחר באותה שעה, ולא בעבר.
 */
export function repostSlot(published: string, now: { date: string; time: string }, rules: RepostRules = DEFAULT_REPOST_RULES) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(published || "");
  if (!m) return null;
  let date = addAfter(m[1], rules.after, rules.unit);
  const time = m[2];
  // גם היום עצמו נדחה למחר: שעה קרובה מדי לא תספיק להיתזמן
  if (date <= now.date) date = shiftDays(now.date, 1);
  return { date, time };
}

/** השדות של הפריט המקורי שלא עוברים להעלאה החוזרת: מצב של הפוסט הקודם, לא תוכן */
const NOT_COPIED = ["id", "date", "time", "autoplan", "intake", "repost", "statusFlags", "scheduled", "ig", "source", "pieceNo", "createdAt"];

export function repostData(src: Record<string, unknown>, o: {
  id: string; date: string; time: string; at: string; file: string; views: number;
  generation: number; rootId: string; fromId: string; publishedAt: string; cover: string | null; automationChoice: string | null;
}) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (!NOT_COPIED.includes(k)) data[k] = v;
  const keyword = (src.intake as { keyword?: string } | undefined)?.keyword;
  return {
    ...data,
    id: o.id, date: o.date, time: o.time,
    filmed: true, edited: true, scheduled: false,
    statusFlags: { filmed: true, edited: true, scheduled: false },
    createdAt: Date.parse(o.at),
    ...(o.automationChoice ? { automationChoice: o.automationChoice } : {}),
    // intake: כדי שהשיבוץ האוטומטי יתזמן אותו כמו סרטון מהתיקייה. sourceKey שונה מהמקור,
    // כדי שהסנכרון במחשב (שממפה לפי sourceKey) לא יתבלבל ביניהם.
    intake: { source: "repost", sourceKey: `repost:${o.fromId}`, file: o.file, at: o.at, ...(keyword ? { keyword } : {}) },
    repost: {
      from: o.fromId, root: o.rootId, generation: o.generation, views: o.views,
      publishedAt: o.publishedAt, cover: o.cover,
    },
  };
}
