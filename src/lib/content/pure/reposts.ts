/**
 * העלאה חוזרת של סרטון שהצליח (גיא, 14.11.2026). הכללים בלבד, בלי מסד — הבדיקות
 * ב-tests/content/reposts.test.mjs. המנוע ב-src/lib/content/reposts.ts.
 *
 *  - סרטון שעבר 1000 צפיות באינסטגרם עולה שוב חודשיים אחרי העלייה המקורית,
 *    באותו יום בחודש ובאותה שעה (22.10 18:00 → 22.12 18:00), לאותן רשתות.
 *  - העלאה חוזרת עולה שוב (חודשיים אחריה) רק אם היא עצמה עברה 2000 צפיות.
 *  - כל העלאה מולידה לכל היותר העלאה חוזרת אחת.
 */

export const FIRST_THRESHOLD = 1000;
export const REPEAT_THRESHOLD = 2000;
export const REPOST_MONTHS = 2;

/** הסף לסרטון: מקורי (generation 0) או העלאה חוזרת */
export function thresholdFor(generation: number) {
  return generation > 0 ? REPEAT_THRESHOLD : FIRST_THRESHOLD;
}

/** "מעל 1000" — 1000 בדיוק לא נחשב */
export function qualifies(views: unknown, generation: number) {
  const n = Number(views);
  return Number.isFinite(n) && n > thresholdFor(generation);
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

function nextDay(date: string) {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * מתי ההעלאה החוזרת. `published` הוא השעה המקומית שבה המקור עלה (YYYY-MM-DDTHH:MM).
 * אם היום הזה כבר הגיע (הצפיות הגיעו באיחור) — מחר באותה שעה, ולא בעבר.
 */
export function repostSlot(published: string, now: { date: string; time: string }) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(published || "");
  if (!m) return null;
  let date = addMonths(m[1], REPOST_MONTHS);
  const time = m[2];
  // גם היום עצמו נדחה למחר: שעה קרובה מדי לא תספיק להיתזמן
  if (date <= now.date) date = nextDay(now.date);
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
