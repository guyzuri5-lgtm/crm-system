import "server-only";

/**
 * שליחת מייל דרך Postmark.
 *
 * ── למה לא Gmail ──
 * עד 2.9.2026 המערכת שלחה דרך Gmail API עם טוקן OAuth אישי. שתי בעיות הפילו
 * אותו: טוקן של אפליקציה במצב "Testing" פג אצל גוגל כל 7 ימים (וכל המיילים
 * נשברו בשקט ב-31.8), ומכסת Gmail היא כ-500 ליום — פחות מרשימת התפוצה עצמה.
 * דיוור מחשבון Gmail אישי גם נוחת בספאם הרבה יותר.
 *
 * ── שני ערוצים, לא אחד ──
 * Postmark מפריד לגמרי בין תעבורה תפעולית לדיוור, כולל טווחי IP נפרדים, ודורש
 * שכל שליחה המונית תעבור ב-Broadcast Stream. זה לטובתנו: אישור פגישה לא ייתקע
 * מאחורי ניוזלטר, וניוזלטר שיקבל תלונות לא יפגע במסירה של האישורים.
 * https://postmarkapp.com/support/article/can-i-send-bulk-emails
 */

const API_URL = "https://api.postmarkapp.com/email";

/** תפעולי = הודעה אחת לאדם אחד. דיוור = הודעה אחת להרבה אנשים. */
export type MessageStream = "transactional" | "broadcast";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** ברירת המחדל תפעולית — שליחה המונית חייבת לבקש broadcast במפורש. */
  stream?: MessageStream;
  /**
   * כתובת ההסרה, לכותרת List-Unsubscribe.
   *
   * מאז 2024 Gmail ו-Yahoo דורשים ממי ששולח בכמות כותרת הסרה בלחיצה אחת, וההסרה
   * שבתוך גוף המייל אינה מספיקה להם. בלי זה הדיוור נענש במסירה.
   */
  listUnsubscribeUrl?: string;
}

function streamId(stream: MessageStream): string {
  return stream === "broadcast"
    ? (process.env.POSTMARK_BROADCAST_STREAM ?? "broadcast")
    : (process.env.POSTMARK_TRANSACTIONAL_STREAM ?? "outbound");
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_FROM);
}

export async function sendEmail({
  to,
  subject,
  html,
  stream = "transactional",
  listUnsubscribeUrl,
}: SendEmailInput): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM;

  if (!token || !from) {
    throw new Error(
      "שליחת מייל לא מוגדרת — חסרים POSTMARK_SERVER_TOKEN או POSTMARK_FROM (ראו README)."
    );
  }

  // כותרת הסרה בלחיצה אחת. שתי הכותרות יחד — בלי השנייה, ספקי הדואר מתייחסים
  // לראשונה כקישור להצגה בלבד ולא כפעולה שהם יכולים לבצע בשם הנמענת.
  const headers = listUnsubscribeUrl
    ? [
        { Name: "List-Unsubscribe", Value: `<${listUnsubscribeUrl}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ]
    : undefined;

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      Subject: subject,
      HtmlBody: html,
      MessageStream: streamId(stream),
      ...(process.env.POSTMARK_REPLY_TO ? { ReplyTo: process.env.POSTMARK_REPLY_TO } : {}),
      ...(headers ? { Headers: headers } : {}),
    }),
  });

  // Postmark מחזיר 200 עם ErrorCode 0 בהצלחה, ו-4xx עם קוד והסבר בכישלון.
  // שניהם JSON, ולכן הבדיקה על הגוף ולא רק על הסטטוס.
  const result = (await response.json().catch(() => null)) as {
    ErrorCode?: number;
    Message?: string;
  } | null;

  if (!response.ok || (result?.ErrorCode ?? 0) !== 0) {
    const code = result?.ErrorCode ?? response.status;
    const message = result?.Message ?? response.statusText;
    // 406 = הנמענת מסומנת inactive אצל Postmark אחרי bounce קשה או תלונת ספאם.
    // ההודעה הגולמית באנגלית לא אומרת את זה למי שקורא את היומן בעברית.
    throw new Error(
      code === 406
        ? `Postmark חוסם שליחה לכתובת הזו (${to}) — היא סומנה כלא פעילה אחרי החזרה או תלונת ספאם.`
        : `Postmark החזיר שגיאה ${code}: ${message}`
    );
  }
}
