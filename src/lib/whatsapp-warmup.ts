/**
 * שבוע החימום של מספר וואטסאפ חדש — חישוב טהור, בלי מסד ובלי רשת.
 *
 * מספר שהתחיל לשלוח הודעות אוטומטיות בכמות מלאה ביום הראשון שלו הוא מספר
 * שוואטסאפ מסמנת. החימום מתחיל ב-15 ביום ועולה בקו ישר עד התקרה שנקבעה,
 * שאליה מגיעים ביום השביעי.
 *
 * הקובץ לא מייבא כלום, כדי שאפשר יהיה לבדוק אותו ב-node --test ישירות
 * (tests/whatsapp/warmup.test.mjs).
 */

export const WARMUP_DAYS = 7;
export const WARMUP_START_LIMIT = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WarmupInput {
  dailyLimit: number;
  warmupEnabled: boolean;
  /** ISO. null = החימום לא התחיל (המיגרציה עוד לא רצה) — אז אין חימום. */
  warmupStartedAt: string | null;
}

export interface WarmupState {
  /** התקרה שבאמת חלה היום. */
  effectiveLimit: number;
  /** היום בחימום, 1–7. null כשאין חימום פעיל (כבוי, הסתיים, או לא התחיל). */
  day: number | null;
}

export function warmupState(input: WarmupInput, now: Date = new Date()): WarmupState {
  const full = { effectiveLimit: input.dailyLimit, day: null };
  if (!input.warmupEnabled || !input.warmupStartedAt) return full;

  const started = new Date(input.warmupStartedAt).getTime();
  if (Number.isNaN(started)) return full;

  const day = Math.floor((now.getTime() - started) / DAY_MS) + 1;
  if (day < 1 || day > WARMUP_DAYS) return full;

  // תקרה שנקבעה נמוכה מנקודת ההתחלה — אין מה לחמם, היא כבר שמרנית.
  if (input.dailyLimit <= WARMUP_START_LIMIT) return { effectiveLimit: input.dailyLimit, day };

  const step = (input.dailyLimit - WARMUP_START_LIMIT) / (WARMUP_DAYS - 1);
  return { effectiveLimit: Math.round(WARMUP_START_LIMIT + step * (day - 1)), day };
}

/** רווח אקראי בשניות בין שתי הודעות אוטומטיות, כולל שני הקצוות. */
export function randomGapSeconds(min: number, max: number, random: () => number = Math.random): number {
  const low = Math.max(0, Math.min(min, max));
  const high = Math.max(low, max);
  return low + Math.floor(random() * (high - low + 1));
}

// ── שעות שקטות ─────────────────────────────────────────────────────────

export interface QuietInput {
  enabled: boolean;
  /** שעה בשעון ישראל, 0–23. השקט מתחיל בה... */
  startHour: number;
  /** ...ונגמר בה. כשהתחלה > סוף, השקט עובר את חצות (21 → 8). */
  endHour: number;
  shabbat: boolean;
}

/** שבת: מיום שישי ב-14:00 עד מוצאי שבת ב-20:00, שעון ישראל. */
const SHABBAT_START = { day: 5, hour: 14 };
const SHABBAT_END = { day: 6, hour: 20 };

/** יום בשבוע (0 = ראשון) ושעה, בשעון ישראל. */
function israelDayHour(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return { day, hour };
}

/**
 * האם עכשיו זמן שקט — כלומר וואטסאפ אוטומטי לא יוצא.
 *
 * הודעה ממסע או מכלל בשתיים בלילה או בשבת היא גם גסה וגם חשודה: אדם לא שולח
 * עשרים הודעות עסקיות בלילה. מה שנדחה כאן יוצא בריצה הראשונה אחרי השקט.
 */
export function isQuietTime(input: QuietInput, now: Date = new Date()): boolean {
  if (!input.enabled) return false;
  const { day, hour } = israelDayHour(now);

  if (input.shabbat) {
    if (day === SHABBAT_START.day && hour >= SHABBAT_START.hour) return true;
    if (day === SHABBAT_END.day && hour < SHABBAT_END.hour) return true;
  }

  const { startHour: start, endHour: end } = input;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
