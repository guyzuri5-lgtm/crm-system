import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { sendMessageToContact } from "./send";
import { renderTemplate } from "./templates";
import { listAudienceContactIds, renderNewsletterHtml } from "./newsletter";
import type { Contact, Newsletter } from "./supabase/database.types";

/**
 * שליחת הניוזלטרים שהגיע זמנם. נקרא מהקרון, באותו דפוס של
 * runTimeSinceNoReplyRules: עוצר מרצון כשנגמר התקציב, ומדווח כמה נשארו.
 *
 * ── מה הופך עצירה באמצע לבטוחה ──
 * שורת newsletter_recipients מסומנת sent רק אחרי שליחה מוצלחת, והשאילתה
 * בכל ריצה שואלת "מי עוד pending". אין מצב לשמור, אין מקום לאבד, ואי אפשר
 * לשלוח פעמיים לאותו אדם — המפתח הייחודי (newsletter_id, contact_id) חוסם
 * זאת גם אם משהו ינסה.
 */

export interface NewsletterRunSummary {
  sent: number;
  failed: number;
  /** כמה ניוזלטרים סיימו את כל הקהל שלהם בריצה הזו */
  completed: number;
  /** כמה נמענים נשארו לריצה הבאה */
  remaining: number;
  stopped: "run_limit" | "time_budget" | null;
  errors: { newsletterId: string; contactId: string; error: string }[];
}

/**
 * תקרת שליחות לריצה אחת.
 *
 * המכסה של Gmail היא יומית (כ-500 לחשבון רגיל), וזו אינה היא — זו בלימה של
 * ה*קצב*, כדי ששליחה גדולה תתפרס על כמה ריצות במקום לפרוץ החוצה בבת אחת.
 * הקרון רץ כל רבע שעה, כלומר עד כ-240 בשעה, וזה מספיק לכל רשימה סבירה.
 */
const MAX_SENDS_PER_RUN = 60;

/** הערכה פסימית למשך שליחה אחת — אותו נימוק כמו SEND_ALLOWANCE_MS בוואטסאפ. */
const SEND_ALLOWANCE_MS = 3_000;

type PendingRow = { id: string; contact_id: string; contacts: Contact | null };

export async function runNewsletters(
  now: Date = new Date(),
  budgetMs = 15_000
): Promise<NewsletterRunSummary> {
  const db = supabaseAdmin();
  const deadline = now.getTime() + budgetMs;

  const summary: NewsletterRunSummary = {
    sent: 0,
    failed: 0,
    completed: 0,
    remaining: 0,
    stopped: null,
    errors: [],
  };

  // גם sending ולא רק scheduled: ניוזלטר שנקטע באמצע בגלל התקרה כבר אינו
  // מתוזמן, והוא חייב להימצא שוב בריצה הבאה כדי להמשיך מאותו מקום.
  const { data: due, error } = await db
    .from("newsletters")
    .select("*")
    .in("status", ["scheduled", "sending"])
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at");

  if (error) throw error;
  if (!due?.length) return summary;

  for (const newsletter of due as Newsletter[]) {
    if (summary.stopped) break;

    // ── תמונת מצב של הקהל, פעם אחת ──
    // מי שיצטרף לסטטוס אחרי שהשליחה התחילה לא נכנס אליה באמצע.
    const { count: existing, error: countError } = await db
      .from("newsletter_recipients")
      .select("id", { count: "exact", head: true })
      .eq("newsletter_id", newsletter.id);
    if (countError) throw countError;

    if (!existing) {
      const contactIds = await listAudienceContactIds(newsletter.audience);
      if (contactIds.length) {
        const { error: insertError } = await db.from("newsletter_recipients").insert(
          contactIds.map((contactId) => ({
            newsletter_id: newsletter.id,
            contact_id: contactId,
          }))
        );
        if (insertError) throw insertError;
      }
    }

    if (newsletter.status !== "sending") {
      const { error: statusError } = await db
        .from("newsletters")
        .update({ status: "sending" })
        .eq("id", newsletter.id);
      if (statusError) throw statusError;
    }

    // ── שליחה ──
    const { data: pending, error: pendingError } = await db
      .from("newsletter_recipients")
      .select("id, contact_id, contacts(*)")
      .eq("newsletter_id", newsletter.id)
      .eq("status", "pending")
      .limit(MAX_SENDS_PER_RUN)
      .returns<PendingRow[]>();
    if (pendingError) throw pendingError;

    for (const row of pending ?? []) {
      if (summary.sent + summary.failed >= MAX_SENDS_PER_RUN) {
        summary.stopped ??= "run_limit";
        break;
      }
      if (Date.now() + SEND_ALLOWANCE_MS > deadline) {
        summary.stopped ??= "time_budget";
        break;
      }

      const contact = row.contacts;
      if (!contact) {
        // איש קשר שנמחק בין יצירת התמונה לשליחה. מסומן ולא מדולג, אחרת
        // הניוזלטר לעולם לא יגיע ל-sent.
        await db
          .from("newsletter_recipients")
          .update({ status: "failed", error: "איש הקשר נמחק" })
          .eq("id", row.id);
        summary.failed += 1;
        continue;
      }

      const result = await sendMessageToContact({
        contact,
        channel: "email",
        subject: renderTemplate(newsletter.subject, contact),
        body: renderNewsletterHtml(newsletter, contact),
        logPrefix: "[ניוזלטר]",
      });

      if (result.ok) {
        await db
          .from("newsletter_recipients")
          .update({ status: "sent", error: null })
          .eq("id", row.id);
        summary.sent += 1;
      } else {
        await db
          .from("newsletter_recipients")
          .update({ status: "failed", error: result.error })
          .eq("id", row.id);
        summary.failed += 1;
        summary.errors.push({
          newsletterId: newsletter.id,
          contactId: contact.id,
          error: result.error,
        });
      }
    }

    // ── סגירת חשבון ──
    const [{ count: stillPending }, { count: sentCount }, { count: failedCount }] =
      await Promise.all([
        db
          .from("newsletter_recipients")
          .select("id", { count: "exact", head: true })
          .eq("newsletter_id", newsletter.id)
          .eq("status", "pending"),
        db
          .from("newsletter_recipients")
          .select("id", { count: "exact", head: true })
          .eq("newsletter_id", newsletter.id)
          .eq("status", "sent"),
        db
          .from("newsletter_recipients")
          .select("id", { count: "exact", head: true })
          .eq("newsletter_id", newsletter.id)
          .eq("status", "failed"),
      ]);

    // המונים נכתבים בכל ריצה ולא רק בסוף, כדי שמסך המתוזמנים יראה התקדמות
    // אמיתית בזמן ששליחה גדולה מתפרסת על כמה ריצות.
    const { error: finishError } = await db
      .from("newsletters")
      .update({
        status: stillPending ? "sending" : "sent",
        sent_count: sentCount ?? 0,
        failed_count: failedCount ?? 0,
      })
      .eq("id", newsletter.id);
    if (finishError) throw finishError;

    if (stillPending) summary.remaining += stillPending;
    else summary.completed += 1;
  }

  return summary;
}
