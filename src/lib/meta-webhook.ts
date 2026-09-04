import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * שני הכללים שמטא מפעילה על *כל* webhook שלה — אימות בהרשמה וחתימה על כל
 * בקשה. הם זהים לחלוטין בין המוצרים: אותו מנגנון בדיוק שומר על ההודעות
 * הנכנסות מוואטסאפ ועל הלידים מטפסי הפרסום.
 *
 * הקובץ הזה נוצר כשנוסף ה-webhook השני (לידים, שלב 6). הלוגיקה עצמה נכתבה
 * במקור ב-whatsapp-cloud.ts, ועברה לכאן במקום להשתכפל: העתק שני של השוואת
 * HMAC הוא בדיוק סוג הקוד שמתקן רק במקום אחד — ואז יש endpoint אחד מאובטח
 * ואחד שנראה מאובטח.
 *
 * שתי הפונקציות מקבלות את הסוד כפרמטר ואינן קוראות ל-process.env. כל webhook
 * מביא את משתני הסביבה שלו, וכך אפשר לבדוק אותן בלי להעמיד סביבה שלמה.
 */

/**
 * אימות ה-webhook בהרשמה: Meta שולחת GET עם hub.challenge, ומצפה לקבל אותו
 * בחזרה כטקסט גולמי. זה קורה פעם אחת, כשמחברים את הכתובת בממשק של Meta.
 */
export function verifyMetaChallenge(params: URLSearchParams, expected: string | undefined): string | null {
  if (!expected) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== expected) return null;
  return params.get("hub.challenge");
}

/**
 * אימות החתימה על כל webhook נכנס.
 *
 * Meta חותמת את **גוף הבקשה הגולמי** ב-HMAC-SHA256 עם ה-App Secret, ושולחת
 * את התוצאה ככותרת ‎X-Hub-Signature-256: sha256=<hex>‎. חובה לחשב על הגוף
 * הגולמי בדיוק — JSON.stringify של האובייקט שפורסר מייצר מחרוזת אחרת (סדר
 * מפתחות, רווחים) והחתימה לעולם לא תתאים.
 *
 * ההשוואה ב-timingSafeEqual ולא ב-===: השוואת מחרוזות רגילה נעצרת בתו הראשון
 * שנבדל, וההפרש בזמן מאפשר לנחש חתימה תו אחר תו.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined
): boolean {
  // בלי App Secret אין מה לאמת. מוחזר false ולא true: webhook לא חתום הוא
  // בדיוק מה שתוקף היה שולח, ו"פתוח כברירת מחדל" כאן פירושו שכל אחד יכול
  // להזריק הודעות ל-CRM.
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}
