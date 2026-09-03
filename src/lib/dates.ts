/**
 * הצגת תאריכים בדשבורד, בשעון ישראל.
 *
 * הבעיה שזה פותר: `toLocaleString("he-IL")` בלי `timeZone` משתמש בשעון של
 * המכונה שמריצה את הקוד. במחשב של גיא זה שעון ישראל ולכן הכל נראה תקין, אבל
 * בפרודקשן על Vercel השרת רץ ב-UTC — והודעה שהתקבלה ב-22:00 הוצגה כ-19:00.
 * זה הסוג הגרוע של באג: התוצאה נראית כמו שעה סבירה לגמרי, ולכן אף אחד לא
 * מבחין בה.
 *
 * ── מתי *לא* להשתמש בזה ──
 * 1. **דף קביעת הפגישה הציבורי** — שם מוצג בכוונה שעון הגולשת, כדי שמי שקובעת
 *    מחו"ל תראה את השעה אצלה. ר' `src/lib/booking/timezone.ts`, שמקבל אזור זמן
 *    כפרמטר ונשען על ההגדרה שב-booking_settings.
 * 2. **תאריך בלי שעה שנבנה מ-Date.UTC** (תווית חודש בלוח שנה, שדה מסוג date) —
 *    שם הערך הוא סמן לוח-שנה ולא רגע בזמן, והאזור הנכון עבורו הוא UTC.
 */

export const APP_TIME_ZONE = "Asia/Jerusalem";

/** תאריך ושעה מלאים — "3.9.2026, 20:57:31". */
export function formatDateTime(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("he-IL", { ...options, timeZone: APP_TIME_ZONE });
}

/** תאריך בלבד — "3.9.2026". */
export function formatDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("he-IL", { ...options, timeZone: APP_TIME_ZONE });
}
