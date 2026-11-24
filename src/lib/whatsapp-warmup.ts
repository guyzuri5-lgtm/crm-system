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
