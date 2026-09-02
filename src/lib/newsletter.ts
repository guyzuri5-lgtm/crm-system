import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import { renderTemplate } from "./templates";
// כתובת הבסיס הציבורית. יושבת ב-booking/create כי שם נולדה (קישור ביטול
// פגישה), והיא אותה כתובת בדיוק — אין סיבה לגרסה שנייה שתסטה ממנה.
import { appUrl } from "./booking/create";
import type {
  Contact,
  Newsletter,
  NewsletterAudience,
  NewsletterBlock,
} from "./supabase/database.types";

// ── הקהל ──────────────────────────────────────────────────────────────────

/**
 * מה שמגדיר "מי מקבל", במקום אחד: גם הספירות שבעורך וגם תמונת המצב שנוצרת
 * בתחילת השליחה עוברות דרך כאן. שתי גרסאות של התנאי הזה היו נפרדות ביום
 * שבו מישהו יוסיף לו סייג.
 *
 * מי שאין לו אימייל ומי שהוסר מהתפוצה אינם בקהל — בשום מצב, גם לא כשנבחר
 * "כל אנשי הקשר".
 */
function audienceQuery(audience: NewsletterAudience, select: string) {
  const query = supabaseAdmin()
    .from("contacts")
    .select(select, { count: "exact" })
    .not("email", "is", null)
    .neq("email", "")
    .is("unsubscribed_at", null);

  return audience.type === "statuses" ? query.in("status", audience.statuses) : query;
}

export async function countAudience(audience: NewsletterAudience): Promise<number> {
  const { count, error } = await audienceQuery(audience, "id").limit(0);
  if (error) throw error;
  return count ?? 0;
}

export async function listAudienceContactIds(audience: NewsletterAudience): Promise<string[]> {
  const { data, error } = await audienceQuery(audience, "id");
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string }[]).map((row) => row.id);
}

/** "כל אנשי הקשר" או רשימת הסטטוסים, לתצוגה במסכי הניהול. */
export function audienceLabel(audience: NewsletterAudience): string {
  if (audience.type === "all") return "כל אנשי הקשר";
  return audience.statuses.map((name) => name.replaceAll("_", " ")).join(" · ");
}

// ── קישור ההסרה ───────────────────────────────────────────────────────────

function unsubSecret(): string {
  const secret = process.env.NEWSLETTER_UNSUB_SECRET;
  if (!secret) {
    // נזרק ולא מדולג: ניוזלטר שיוצא בלי קישור הסרה עובד הוא בעיה מול הנמענים
    // ומול ספקי הדואר, ולא משהו שכדאי לגלות אחרי שהוא נשלח.
    throw new Error(
      "NEWSLETTER_UNSUB_SECRET לא מוגדר. בלעדיו אי אפשר לחתום קישורי הסרה מרשימת התפוצה (ראו README)."
    );
  }
  return secret;
}

/** חתימה על מזהה איש הקשר, כדי שאי אפשר יהיה להסיר אנשים בניחוש כתובות. */
export function unsubscribeToken(contactId: string): string {
  return createHmac("sha256", unsubSecret()).update(contactId).digest("hex");
}

export function verifyUnsubscribeToken(contactId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(contactId));
  const received = Buffer.from(token);
  // timingSafeEqual זורק על אורכים שונים, ולכן ההשוואה הזו קודמת.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function unsubscribeUrl(contactId: string): string {
  const params = new URLSearchParams({ c: contactId, t: unsubscribeToken(contactId) });
  return `${appUrl()}/api/newsletter/unsubscribe?${params.toString()}`;
}

// ── רינדור המייל ──────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * עותק של איש הקשר שכל השדות הטקסטואליים שלו מוברחים.
 *
 * בלוק טקסט הוא HTML שגיא כותב, ולכן הוא עובר כמו שהוא — הוא המחבר. מה
 * שנכנס לתוכו מהמסד הוא נתון ולא קוד: איש קשר בשם "<b>" לא אמור להדגיש את
 * שאר המייל. ההברחה כאן ולא ב-renderTemplate כי שם היעד הוא לרוב טקסט רגיל
 * (וואטסאפ), ושם דווקא ההברחה הייתה השגיאה.
 */
function escapedContact(contact: Contact): Contact {
  return {
    ...contact,
    full_name: contact.full_name === null ? null : escapeHtml(contact.full_name),
    phone: contact.phone === null ? null : escapeHtml(contact.phone),
    email: contact.email === null ? null : escapeHtml(contact.email),
    status: escapeHtml(contact.status),
  };
}

const CONTENT_WIDTH = 544;

function renderBlock(block: NewsletterBlock, contact: Contact): string {
  switch (block.type) {
    case "text": {
      // שורה ריקה בעורך היא פסקה חדשה במייל. מי שכותב בתיבת טקסט מצפה לזה.
      const html = renderTemplate(block.html, escapedContact(contact)).replaceAll("\n", "<br>");
      return `<div style="margin:0 0 20px;font-size:16px;line-height:1.75;color:#1c1a17;">${html}</div>`;
    }
    case "image":
      return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" width="${CONTENT_WIDTH}" style="display:block;width:100%;max-width:${CONTENT_WIDTH}px;height:auto;margin:0 0 20px;border-radius:12px;" />`;
    case "youtube": {
      // אין iframe במיילים — אף לקוח דואר לא מריץ אותו. תמונת התצוגה
      // המקדימה של יוטיוב, עטופה בקישור לסרטון, היא מה שכולם עושים.
      const caption = block.caption
        ? `<div style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#6b6459;">${escapeHtml(block.caption)}</div>`
        : "";
      return `<div style="margin:0 0 20px;"><a href="https://www.youtube.com/watch?v=${escapeHtml(block.videoId)}" target="_blank" rel="noopener"><img src="https://img.youtube.com/vi/${escapeHtml(block.videoId)}/hqdefault.jpg" alt="${escapeHtml(block.caption) || "צפייה בסרטון"}" width="${CONTENT_WIDTH}" style="display:block;width:100%;max-width:${CONTENT_WIDTH}px;height:auto;border-radius:12px;" /></a>${caption}</div>`;
    }
  }
}

/**
 * הניוזלטר כפי שהוא מגיע לתיבה של איש קשר אחד.
 *
 * טבלאות ולא flex/grid, ועיצוב inline ולא <style>: לקוחות דואר (במיוחד
 * Outlook) מתעלמים מגיליונות סגנון ומפריסות מודרניות. זה נראה כמו HTML
 * מ-2005 כי זה מה שעובד.
 */
export function renderNewsletterHtml(newsletter: Newsletter, contact: Contact): string {
  const blocks = (newsletter.blocks ?? []).map((block) => renderBlock(block, contact)).join("\n");
  const subject = escapeHtml(renderTemplate(newsletter.subject, escapedContact(contact)));

  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#faf9f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Rubik,Arial,sans-serif;color:#1c1a17;text-align:right;">
<tr><td style="padding:28px 28px 8px;">
${blocks}
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #e7e2dc;font-size:12px;line-height:1.7;color:#a39a8c;">
קיבלת את המייל כי נרשמת אצל גיא ·
<a href="${escapeHtml(unsubscribeUrl(contact.id))}" style="color:#6b6459;">להסרה מרשימת התפוצה</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
