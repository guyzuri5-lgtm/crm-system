import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { zonedTimeToUtc, utcToZonedParts } from "./booking/timezone";
import type { MessageChannel, WhatsAppSettings } from "./supabase/database.types";

/**
 * בלמים על השליחה האוטומטית בוואטסאפ.
 *
 * המנגנון הזה נבנה במקור נגד *חסימה* של המספר, כשהערוץ היה Green API — ערוץ
 * לא רשמי שבו שליחה יזומה בקצב אחיד מסכנת את המספר. Cloud API הוא הערוץ
 * המאושר של Meta ואין בו סיכון כזה, ולכן ההשהיות ירדו (ראו 0011).
 *
 * מה שנשאר, ומשמעותו התהפכה:
 *   1. תקרה יומית — כבר לא מגנה על המספר אלא על **הכיס**. כל תבנית שנמסרת
 *      מחויבת על ידי Meta, ולולאה שהשתבשה היא חשבונית.
 *   2. מתג עצירה — לעצור הכול מיד בלי deploy.
 *   3. תקציב זמן ריצה — שהפונקציה לא תמות באמצע ותשאיר חצי רשימה בלי הודעה.
 *
 * השלישי הוא לא עניין של נימוס אלא של נכונות: פונקציה ב-Vercel נקטעת בכוח
 * כשנגמר לה הזמן, ובלי לעצור מרצון לפני כן, ההודעה שבאמצע שליחה הולכת לאיבוד
 * בלי שיירשם עליה כלום.
 */

/** אזור הזמן שלפיו נספרת "יממה" — אותו אחד ששאר המערכת מניחה. */
const TIMEZONE = "Asia/Jerusalem";

const FALLBACK_SETTINGS: WhatsAppSettings = {
  id: true,
  daily_limit: 40,
  paused: false,
  updated_at: new Date().toISOString(),
};

/**
 * ההגדרות. אם המיגרציה 0010 עוד לא הורצה, מוחזרות ברירות המחדל השמרניות
 * במקום להפיל את הקרון — עדיף שהוא ירוץ מווסת מדי מאשר שלא ירוץ בכלל.
 */
export interface WhatsAppSettingsRead {
  settings: WhatsAppSettings;
  /**
   * הקריאה למסד נכשלה, והערכים שמוחזרים הם ברירת מחדל ולא מה ששמור.
   *
   * הדגל הזה נוסף אחרי שמסך "בלמי שליחה" הציג תיבת השהיה **לא מסומנת** בזמן
   * ש-paused היה true במסד: הקריאה נפלה, הפולבק החזיר paused: false, והמסך
   * הציג אותו כאילו הוא האמת. מסך בטיחות שמראה "פעיל" כשהמערכת עצורה גרוע
   * מכך שלא יוצג כלום — ולכן מי שמציג ערכים למשתמש חייב לדעת מאיפה הם באו.
   */
  degraded: boolean;
}

/** הקריאה הגולמית, כולל האם היא הצליחה. למסכים שמציגים את הערכים למשתמש. */
export async function readWhatsAppSettings(): Promise<WhatsAppSettingsRead> {
  const { data, error } = await supabaseAdmin()
    .from("whatsapp_settings")
    .select("*")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[whatsapp] failed to read whatsapp_settings:", error.message);
    return { settings: FALLBACK_SETTINGS, degraded: true };
  }
  return { settings: data, degraded: false };
}

export async function getWhatsAppSettings(): Promise<WhatsAppSettings> {
  return (await readWhatsAppSettings()).settings;
}

/**
 * כמה הודעות וואטסאפ כבר יצאו היום.
 *
 * נספר מ-interactions ולא ממונה נפרד: מונה יכול להיפרד מהמציאות (הודעה
 * שנשלחה ולא נספרה, או נספרה ולא נשלחה), והספירה הישירה לא יכולה.
 *
 * הספירה כוללת גם הודעות ידניות שנשלחו מהדשבורד — הן נחשבות באותה תקרה,
 * כי וואטסאפ סופר את המספר ולא את מי לחץ על הכפתור. מה שהיא *לא* עושה זה
 * לחסום שליחה ידנית: אדם שלוחץ "שלח" יודע מה הוא עושה, והתקרה נאכפת רק על
 * השליחה האוטומטית.
 */
export async function countWhatsAppSentToday(now: Date = new Date()): Promise<number> {
  const { year, month, day } = utcToZonedParts(now, TIMEZONE);
  const startOfDay = zonedTimeToUtc(year, month, day, 0, TIMEZONE);

  const { count, error } = await supabaseAdmin()
    .from("interactions")
    .select("id", { count: "exact", head: true })
    .eq("type", "whatsapp_out")
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    // נזרק ולא מוחזר 0: בלי לדעת כמה כבר יצא היום, "0" היה פותח את התקרה
    // לרווחה על מספר שאולי כבר על הקצה. כשל כאן עוצר את הריצה כולה, וזו
    // התוצאה הבטוחה — הקרון ירוץ שוב מחר, ושום הודעה לא נשלחת פעמיים.
    console.error("[whatsapp] failed to count today's sends:", error.message);
    throw error;
  }

  return count ?? 0;
}

/**
 * הבקר שמלווה ריצה אחת של הקרון.
 *
 * מחזיק את שלושת הגבולות יחד, כי ההחלטה "לשלוח עוד אחת?" תלויה בשלושתם
 * בבת אחת — ופיצול שלהם לשלוש בדיקות נפרדות בגוף הלולאה הוא בדיוק איך
 * שאחת מהן נשכחת בעדכון הבא.
 */
export class SendBudget {
  private sent = 0;
  private readonly deadline: number;

  private constructor(
    readonly settings: WhatsAppSettings,
    private sentToday: number,
    budgetMs: number,
    startedAt: number
  ) {
    this.deadline = startedAt + budgetMs;
  }

  static async open(budgetMs: number, now: Date = new Date()): Promise<SendBudget> {
    const settings = await getWhatsAppSettings();
    const sentToday = await countWhatsAppSentToday(now);
    return new SendBudget(settings, sentToday, budgetMs, now.getTime());
  }

  /** כמה עוד מותר היום לפי התקרה. */
  get remainingToday(): number {
    return Math.max(0, this.settings.daily_limit - this.sentToday - this.sent);
  }

  get sentThisRun(): number {
    return this.sent;
  }

  /**
   * האם יש מקום להודעה נוספת *בריצה הזו*.
   *
   * תקציב הזמן נבדק מול הערכה פסימית של משך השליחה: הבדיקה חייבת להיות נכונה
   * גם במקרה הגרוע, אחרת ההודעה האחרונה בכל ריצה תיקטע באמצע.
   *
   * ── למה הערוץ הוא פרמטר ──
   * שתיים מהסיבות חלות על כל שליחה אוטומטית, ואחת לא:
   *   paused      — חלה על הכול. המתג אומר "שום דבר לא יוצא מעצמו", וזה כולל
   *                 מייל. זו הסיבה שהוא כאן ולא רק בבדיקת הוואטסאפ.
   *   time_budget — חלה על הכול. הפונקציה עומדת להיקטע, בלי קשר לערוץ.
   *   daily_limit — וואטסאפ בלבד. היא סופרת הודעות שמטא מחייבת עליהן, ולמייל
   *                 אין לה משמעות.
   *
   * הערוץ מתקבל כפרמטר ולא נבדק אצל הקורא, כי הניסיון הקודם — שכל מנוע סינן
   * בעצמו לפי הסיבה שחזרה — הותיר את מנוע הכללים בלי מתג השהיה ובלי תקציב
   * זמן על מייל, וגרם למנוע המסעות לדלג על בדיקת הזמן בכל פעם שהתקרה היומית
   * של הוואטסאפ נגמרה (הבדיקה מחזירה סיבה אחת, ו-daily_limit קדמה לה).
   *
   * ברירת המחדל היא וואטסאפ — הערוץ המגביל מבין השניים. קורא ששכח להעביר
   * ערוץ מקבל את ההתנהגות השמרנית ולא את המתירנית.
   */
  canSend(
    channel: MessageChannel = "whatsapp"
  ): { ok: true } | { ok: false; reason: "paused" | "daily_limit" | "time_budget" } {
    if (this.settings.paused) return { ok: false, reason: "paused" };
    if (channel === "whatsapp" && this.remainingToday <= 0) {
      return { ok: false, reason: "daily_limit" };
    }
    if (Date.now() + SEND_ALLOWANCE_MS > this.deadline) {
      return { ok: false, reason: "time_budget" };
    }
    return { ok: true };
  }

  /**
   * נקרא אחרי שליחה מוצלחת בלבד — הודעה שנכשלה לא נמסרה, לא חויבה, ולכן לא
   * צרכה מהתקרה כלום.
   */
  countSent(): void {
    this.sent += 1;
  }

}

/**
 * האם השליחה האוטומטית מושהית.
 *
 * המתג הזה גדול מהוואטסאפ. הוא אומר "שום דבר לא יוצא מעצמו", והוא הדבר
 * היחיד במערכת שאפשר לסמוך עליו כשלא בטוחים מה מתוזמן — ולכן הוא חייב
 * לחסום גם מייל. התקרה היומית, לעומתו, נשארת של הוואטסאפ בלבד: היא סופרת
 * הודעות שמטא מחייבת עליהן, ולמייל אין לה שום משמעות.
 *
 * עד עכשיו ההשהיה ישבה רק בתוך SendBudget, שהמנועים של הניוזלטר ושל
 * תזכורות האירועים לא עוברים דרכו בכלל — כך שהמתג היה דלוק והמיילים המשיכו
 * לצאת.
 */
export async function isSendingPaused(): Promise<boolean> {
  return (await getWhatsAppSettings()).paused;
}

/**
 * כמה זמן להניח שהודעה אחת תיקח.
 *
 * שלוש שניות ולא חצי: זו קריאת רשת ל-Graph API ואחריה כתיבה ל-Supabase,
 * ובמקרה של קריאה איטית הערכה נמוכה מדי הייתה גורמת לפונקציה להיקטע בדיוק
 * במה שהמנגנון הזה אמור למנוע.
 */
const SEND_ALLOWANCE_MS = 3_000;
