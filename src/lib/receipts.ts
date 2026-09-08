import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import type { MessageChannel, MessageReceipt } from "./supabase/database.types";

/**
 * מה קרה להודעה אחרי שיצאה.
 *
 * המקום היחיד שכותב ל-message_receipts, ושני ה-webhooks קוראים לו: וואטסאפ
 * מדווח delivered/read/failed, ו-Postmark מדווח Delivery/Open/Click/Bounce.
 * השמות כאן ניטרליים לערוץ בכוונה — "נפתח" בוואטסאפ הוא הסימון הכחול ובמייל
 * הוא טעינת תמונת המעקב, וההבדל ביניהם שייך למי שמציג את המספר, לא למי
 * שכותב אותו.
 *
 * ── למה זה לא נכשל כשההודעה עוד לא ביומן ──
 * הדיווח מקדים לפעמים את שורת היומן שהוא מדבר עליה (ראו הערת המיגרציה
 * 0037). המפתח כאן הוא מזהה ההודעה ולא מפתח זר, ולכן שורת דיווח יכולה
 * להיווצר לבדה ולחכות — היא תתחבר ליומן בשאילתה, לא בכתיבה.
 */
export type ReceiptEvent = "delivered" | "opened" | "clicked" | "failed";

export interface RecordReceiptInput {
  externalId: string;
  channel: MessageChannel;
  event: ReceiptEvent;
  /** מתי זה קרה לפי הספק. ברירת מחדל: עכשיו. */
  at?: string;
  /** רק ל-failed. */
  error?: string | null;
}

/** האם התאריך החדש מוקדם מזה השמור, או שאין שמור. הראשון קובע. */
function earliest(existing: string | null | undefined, incoming: string): string {
  if (!existing) return incoming;
  return new Date(incoming) < new Date(existing) ? incoming : existing;
}

/**
 * רישום דיווח אחד.
 *
 * ── קריאה ואז כתיבה, ולא כתיבה בלבד ──
 * שלוש התנהגויות שונות דרושות כאן: תאריך ראשון נשמר ולא נדרס (פתיחה שנייה
 * לא אמורה להזיז את "נפתח לראשונה"), מונה גדל, ושדה שלא הגיע בדיווח הזה לא
 * מתאפס. upsert לבדו יודע רק להחליף שורה שלמה.
 *
 * שני דיווחים שיגיעו באותו רגע *בדיוק* על אותה הודעה עלולים לאבד ספירה אחת.
 * זה מקרה קצה תיאורטי — הספקים מדווחים אירועים בזה אחר זה — והמחיר של
 * לסגור אותו (נעילה או פונקציה במסד) גדול מהתועלת: מונה פתיחות שמראה 3
 * במקום 4 אינו שובר שום החלטה.
 */
export async function recordReceipt(input: RecordReceiptInput): Promise<void> {
  const db = supabaseAdmin();
  const at = input.at ?? new Date().toISOString();

  const { data: existingRaw, error: readError } = await db
    .from("message_receipts")
    .select("*")
    .eq("external_id", input.externalId)
    .maybeSingle();
  if (readError) throw readError;

  const existing = existingRaw as MessageReceipt | null;

  // המצב הקיים כבסיס, והדיווח הנוכחי משנה ממנו רק את מה שהוא מדווח עליו.
  const row = {
    external_id: input.externalId,
    channel: input.channel,
    delivered_at: existing?.delivered_at ?? null,
    opened_at: existing?.opened_at ?? null,
    clicked_at: existing?.clicked_at ?? null,
    failed_at: existing?.failed_at ?? null,
    error: existing?.error ?? null,
    open_count: existing?.open_count ?? 0,
    click_count: existing?.click_count ?? 0,
    updated_at: new Date().toISOString(),
  };

  switch (input.event) {
    case "delivered":
      row.delivered_at = earliest(existing?.delivered_at, at);
      break;
    case "opened":
      row.opened_at = earliest(existing?.opened_at, at);
      row.open_count = (existing?.open_count ?? 0) + 1;
      // נקרא/נפתח מעיד על מסירה גם כשדיווח המסירה עצמו אבד בדרך.
      row.delivered_at = existing?.delivered_at ?? at;
      break;
    case "clicked":
      row.clicked_at = earliest(existing?.clicked_at, at);
      row.click_count = (existing?.click_count ?? 0) + 1;
      // מי שלחץ, פתח — גם אם תמונת המעקב נחסמה ולא דיווחה.
      row.opened_at = existing?.opened_at ?? at;
      row.delivered_at = existing?.delivered_at ?? at;
      break;
    case "failed":
      row.failed_at = earliest(existing?.failed_at, at);
      row.error = input.error ?? existing?.error ?? null;
      break;
  }

  const { error } = await db.from("message_receipts").upsert(row, { onConflict: "external_id" });
  if (error) throw error;
}

/**
 * דיווחים רבים בבת אחת, סדרתית.
 *
 * במקביל אי אפשר: שני דיווחים על אותה הודעה באותו payload (delivered ואז
 * read מגיעים לפעמים יחד) היו קוראים את אותה שורה לפני שאף אחד מהם כתב,
 * והשני היה דורס את הראשון.
 *
 * מחזירה כמה נכשלו — כדי שכשל ברישום לא יפיל את כל ה-webhook. דיווח שאבד
 * הוא נתון חסר בסטטיסטיקה; webhook שמחזיר שגיאה גורר את הספק לשלוח הכל שוב.
 */
export async function recordReceipts(events: RecordReceiptInput[]): Promise<number> {
  let failed = 0;
  for (const event of events) {
    try {
      await recordReceipt(event);
    } catch (error) {
      failed += 1;
      console.error(`[receipts] רישום נכשל (${event.externalId}/${event.event}):`, error);
    }
  }
  return failed;
}
