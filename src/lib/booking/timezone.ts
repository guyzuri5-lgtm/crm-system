/**
 * המרות בין "שעת קיר" באזור זמן לבין רגע בציר הזמן — בלי ספריית תאריכים.
 *
 * למה זה קיים בכלל: שעות הזמינות נשמרות כדקות מחצות ("ראשון, 540–1020"), וזו
 * שעת קיר. הרגע בציר הזמן שאליו היא מתורגמת משתנה בין קיץ לחורף — 9:00 בירושלים
 * הוא 06:00Z בקיץ ו-07:00Z בחורף. כל חישוב שמניח היסט קבוע יזיז את כל היום
 * בשעה פעמיים בשנה, וזה בדיוק סוג הבאג שמתגלה רק אחרי שלקוח מגיע בשעה הלא נכונה.
 *
 * הכל נשען על Intl.DateTimeFormat, שיודע את מסד הנתונים של אזורי הזמן של
 * המערכת — ולכן אין כאן טבלת מעברי שעון קיץ לתחזק.
 */

/**
 * ההיסט בדקות של אזור הזמן ברגע נתון (ירושלים: 120 בחורף, 180 בקיץ).
 *
 * הטריק: מפרמטים את הרגע לפי אזור הזמן, ואז קוראים לרכיבים שיצאו כאילו היו
 * UTC. ההפרש בין המספר הזה לרגע המקורי הוא ההיסט.
 */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // חלק ממימושי ICU מחזירים 24 במקום 0 לחצות.
  const hour = value("hour") % 24;

  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    hour,
    value("minute"),
    value("second")
  );

  // asIfUtc מעוגל לשנייה שלמה, אז משווים מול הרגע המקורי מעוגל גם הוא.
  const flooredInstant = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - flooredInstant) / 60_000;
}

/**
 * שעת קיר באזור הזמן → רגע בציר הזמן.
 *
 * שני מעברים ולא אחד: ההיסט תלוי ברגע, והרגע הוא מה שאנחנו מנסים למצוא.
 * הניחוש הראשון מניח שהשעה היא UTC, מתקן לפיו, והמעבר השני מתקן שוב לפי
 * ההיסט שתקף *ברגע המתוקן* — מה שמייצב את התוצאה גם ביום המעבר לשעון קיץ.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string
): Date {
  const wallClock = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minutesFromMidnight / 60),
    minutesFromMidnight % 60
  );

  const firstPass = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60_000;
  const secondPass = wallClock - offsetMinutes(new Date(firstPass), timeZone) * 60_000;
  return new Date(secondPass);
}

export interface ZonedParts {
  year: number;
  month: number;
  /** יום בחודש */
  day: number;
  /** 0 = ראשון, כמו Date#getDay ו-booking_availability.weekday */
  weekday: number;
  /** דקות מחצות באזור הזמן */
  minutes: number;
}

/** רגע בציר הזמן → הרכיבים שלו כפי שהם נראים באזור הזמן. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour") % 24;
  const minute = value("minute");

  return {
    year,
    month,
    day,
    // getUTCDay על אותם רכיבים נותן את היום בשבוע המקומי בלי תלות באזור הזמן
    // של השרת (ב-Vercel הוא UTC, במחשב הפיתוח לא — וזה היה מייצר הבדל).
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: hour * 60 + minute,
  };
}

/** מפתח תאריך יציב לקיבוץ סלוטים לפי יום, באזור הזמן ולא לפי UTC. */
export function zonedDateKey(instant: Date, timeZone: string): string {
  const { year, month, day } = utcToZonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "2026-08-24" → הרכיבים שלו, בלי לעבור דרך Date (שהיה מפרש אותו כ-UTC). */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** הוספת ימים על מפתח תאריך, בלי סיבוכי שעון קיץ (חשבון על UTC בלבד). */
export function addDaysToDateKey(key: string, days: number): string {
  const parsed = parseDateKey(key);
  if (!parsed) return key;
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
    shifted.getUTCDate()
  ).padStart(2, "0")}`;
}

const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function hebrewWeekday(weekday: number): string {
  return HEBREW_WEEKDAYS[weekday] ?? "";
}

/** "14:30" באזור הזמן הנתון. */
export function formatTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/** "יום ראשון, 24 באוגוסט 2026" */
export function formatLongDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(instant);
}

/** "יום ראשון, 24 באוגוסט 2026, 14:30" — לשורה אחת במייל ובדשבורד. */
export function formatDateTime(instant: Date, timeZone: string): string {
  return `${formatLongDate(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

/** דקות מחצות → "09:30", לשדות טופס ולתצוגת שעות הזמינות. */
export function minutesToClock(minutes: number): string {
  const normalized = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/** "09:30" → 570. מחזיר null על קלט שאינו שעה תקינה. */
export function clockToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total > 1440 ? null : total;
}

/**
 * האם הרגע כבר עבר.
 *
 * יושב כאן ולא בגוף הרכיב בכוונה: Date.now הוא פונקציה לא־טהורה, וקריאה לה
 * בזמן רינדור מייצרת תוצאה שיכולה להשתנות בין רינדור לרינדור (וכלל
 * react-hooks/purity חוסם אותה). כלוגיקת דומיין בקובץ נפרד זה גם פשוט נכון יותר.
 */
export function hasPassed(instant: Date): boolean {
  return instant.getTime() < Date.now();
}
