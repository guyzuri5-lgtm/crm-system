import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import type { WebhookInboxRow, WebhookSource } from "./supabase/database.types";

/**
 * תיבת הדואר הנכנס של ה-webhooks (0030).
 *
 * הרעיון במשפט אחד: **קודם שומרים, אחר כך מבינים.** כל payload שמגיע ממטא או
 * מגרואו נכתב לטבלה כמו שהוא, לפני שנוגעים בו, ורק אז מתחיל העיבוד. עיבוד
 * שנכשל מסמן את השורה ומשאיר בה הסבר — והמידע הגולמי נשאר שלם.
 *
 * למה זה שווה טבלה שלמה: אנחנו לא יודעים איך ה-payload של גרואו נראה, ומטא
 * משנה את שמות השדות מטופס לטופס. בלי התיבה, הליד הראשון בפורמט לא צפוי היה
 * מייצר 500 ונעלם — ואי אפשר לבקש מהלקוחה להירשם שוב אם לא יודעים שהיא ניסתה.
 */

/** "הטבלה לא קיימת" — הקוד עלה אבל 0030 עוד לא הורצה. */
export function assertInboxMigrated(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    throw new Error(
      "טבלאות תיבת ה-webhooks לא קיימות. יש להריץ את supabase/migrations/0030_webhook_inbox.sql ב-SQL editor של Supabase."
    );
  }
}

/**
 * שמירת ה-payload הגולמי. מחזיר את מזהה השורה, או null אם השמירה נכשלה.
 *
 * **הפונקציה הזו לא זורקת, לעולם.** היא רשת הביטחון, ורשת שמפילה את מי
 * שנופל לתוכה חסרת ערך: אם התיבה עצמה לא זמינה (0030 לא הורצה, המסד למטה),
 * העיבוד חייב להמשיך ולנסות לקלוט את הליד בכל זאת. הכישלון נרשם ללוג, וכל
 * מי שקורא לה מתייחס ל-null כ"אין שורה לסמן" ולא כ"עצור".
 */
export async function recordIncoming(source: WebhookSource, payload: unknown): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("webhook_inbox")
      .insert({ source, payload })
      .select("id")
      .single();
    if (error) {
      console.error(`[webhook-inbox] שמירת payload מ-${source} נכשלה:`, error.message);
      return null;
    }
    return data.id;
  } catch (err) {
    console.error(`[webhook-inbox] שמירת payload מ-${source} נכשלה:`, err);
    return null;
  }
}

/** סימון שהעיבוד הצליח. מנקה גם שגיאה קודמת, אם השורה עובדה שוב. */
export async function markProcessed(id: string | null): Promise<void> {
  if (!id) return;
  const { error } = await supabaseAdmin()
    .from("webhook_inbox")
    .update({ processed: true, error: null })
    .eq("id", id);
  if (error) console.error("[webhook-inbox] סימון כמעובד נכשל:", error.message);
}

/**
 * סימון שהעיבוד נכשל, עם הסבר.
 *
 * processed נשאר false — זו כל הנקודה. השורה תמשיך להופיע במסך ההגדרות עד
 * שמישהו יטפל בה, וההסבר הוא מה שיאמר לו מה חסר ("טופס 123 לא משויך").
 */
export async function markFailed(id: string | null, reason: string): Promise<void> {
  if (!id) return;
  const { error } = await supabaseAdmin()
    .from("webhook_inbox")
    .update({ processed: false, error: reason.slice(0, 500) })
    .eq("id", id);
  if (error) console.error("[webhook-inbox] סימון ככושל נכשל:", error.message);
}

/**
 * מה תקוע. מסך ההגדרות מציג את זה כהתראה.
 *
 * מוגבל ל-50: מי שיש לו יותר מזה תקוע לא צריך רשימה ארוכה יותר אלא לתקן את
 * השיוך, והמסך לא אמור להפוך לדפדפן JSON.
 */
export async function listPending(source?: WebhookSource, limit = 50): Promise<WebhookInboxRow[]> {
  let query = supabaseAdmin()
    .from("webhook_inbox")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  assertInboxMigrated(error);
  if (error) throw new Error(error.message);
  return data ?? [];
}
