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
 *
 * ── מעקב פתיחות וקליקים (0037) ──
 * שני מעקבים נפרדים, ולכן שתי החלטות נפרדות:
 *
 * פתיחה — תמונה שקופה בגוף ההודעה. אינה נוגעת בקישורים, ולכן דלוקה בכל
 * שליחה. אינה מדד מדויק: אפל פותחת אוטומטית כל מייל של מי שמשתמש ב-Mail
 * באייפון (מנפח), ומי שחוסם תמונות אינו נספר כלל (מקזז). שווה כמגמה בין
 * דיוורים, לא כמספר מוחלט.
 *
 * קליק — Postmark מחליף כל קישור בגוף בכתובת הפניה משלו. **דלוק רק בדיוור.**
 * הקישור לקורס הוא כל תוכן ההודעה התפעולית, ואין סיבה להעמיד הפניה של צד
 * שלישי בין הלקוח לבין מה שהוא שילם עליו: מספיק שהיא תיחסם או תאט, והלקוח
 * לא הגיע. בניוזלטר הקליק הוא כל מה שיש למדוד, ושם התמורה שווה את הסיכון.
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

// ── טקסט רגיל → HTML ──────────────────────────────────────────────────────

/**
 * האם הגוף שהתקבל כבר HTML.
 *
 * הבדיקה היא על תגית ממשית ולא על התו "<" לבדו, כדי שתבנית שכתוב בה
 * "מחיר < 100" לא תיחשב בטעות ל-HTML ותאבד את ירידות השורה שלה.
 */
export function looksLikeHtml(body: string): boolean {
  return /<[a-z!/][^>]*>/i.test(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * הופכת כתובת גלויה בטקסט לקישור שאפשר ללחוץ עליו.
 *
 * ג'ימייל עושה זאת בעצמו, ולכן קל להחמיץ שלקוחות דואר אחרים לא — והקישור
 * לקורס הוא כל תוכן ההודעה. ה-‎&amp;‎ שנוצר בהברחה הוא הצורה הנכונה של ‎&‎
 * בתוך href, ולכן הסדר כאן הוא הברחה ואז קישור, ולא הפוך.
 */
function linkify(escaped: string): string {
  return escaped.replace(
    /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g,
    // dir=ltr + unicode-bidi:isolate — בלעדיהם הלוכסן שבסוף הכתובת "קופץ"
    // לתחילתה כשהיא יושבת בתוך פסקה בעברית, והקישור נקרא ‎/https://…‎.
    // הכתובת עצמה תקינה גם בלי זה; מה שנשבר הוא רק מה שהעין רואה — וזה
    // הקישור שכל המייל נכתב בשבילו.
    (url) =>
      `<a href="${url}" dir="ltr" style="color:#0c6b62;unicode-bidi:isolate;">${url}</a>`
  );
}

/**
 * גוף מייל שנכתב כטקסט רגיל, עטוף כ-HTML שנראה כמו שנכתב.
 *
 * ── הבאג שזה מתקן ──
 * הגוף נמסר ל-Postmark כ-HtmlBody, וב-HTML ירידת שורה היא רווח. תבנית
 * שנכתבה בפסקאות מסודרות הגיעה ללקוחה כגוש טקסט אחד רצוף. זה קרה בפועל
 * במייל הראשון שיצא ללקוחה משלמת (7.9.2026).
 *
 * שורה ריקה פותחת פסקה חדשה, ירידת שורה בודדת היא ‎<br>‎ — בדיוק מה שמי
 * שמקליד בתיבת טקסט מצפה לו, ואותו כלל שכבר נהוג בעורך הניוזלטר.
 */
export function plainTextToEmailHtml(text: string, unsubscribeHref?: string): string {
  // ── נרמול סיומות שורה, וזה לא ניקיון אלא תיקון באג ──
  //
  // textarea בדפדפן שולח CRLF לפי תקן ה-HTML, ולכן "שורה ריקה" שמפרידה בין
  // פסקאות שמורה במסד כ-‎\r\n\r\n‎. פיצול על ‎\n{2,}‎ לא מזהה אותה, כי ה-‎\r‎
  // חוצץ בין שתי ירידות השורה — והתוצאה היא שכל המייל נחשב לפסקה אחת.
  // נמדד על התבנית האמיתית: לפני הנרמול פסקה אחת, אחריו שמונה.
  //
  // הרווחים בסוף שורה נגזרים מאותה סיבה: שורה שנראית ריקה ויש בה רווח אינה
  // ריקה, ומפרידה בין פסקאות שהמשתמש התכוון אליהן.
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");

  const paragraphs = escapeHtml(normalized.trim())
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#1c1a17;">${linkify(block).replaceAll("\n", "<br>")}</p>`
    )
    .join("\n");

  // ── פוטר ההסרה ──
  //
  // רק כשנמסרה כתובת, כלומר רק בדיוור שיווקי. כותרת List-Unsubscribe לבדה
  // אינה מספיקה: היא נקראת בידי ספק הדואר, וחוק הדואר האלקטרוני מדבר על
  // הנמען — הוא צריך לראות דרך יציאה בגוף ההודעה עצמה.
  const footer = unsubscribeHref
    ? `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e7e2da;font-size:13px;line-height:1.7;color:#8a8178;">
קיבלת את המייל הזה כי השארת פרטים אצלנו.
<a href="${escapeHtml(unsubscribeHref)}" style="color:#8a8178;">להסרה מרשימת התפוצה</a>
</p>`
    : "";

  // טבלאות ועיצוב inline ולא flex/grid ו-<style>: לקוחות דואר (במיוחד
  // Outlook) מתעלמים מגיליונות סגנון ומפריסות מודרניות. אותה מעטפת של
  // הניוזלטר; הפוטר שלה מופיע רק כשההודעה היא דיוור.
  return `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#faf9f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Rubik,Arial,sans-serif;color:#1c1a17;text-align:right;">
<tr><td style="padding:28px;">
${paragraphs}
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function streamId(stream: MessageStream): string {
  return stream === "broadcast"
    ? (process.env.POSTMARK_BROADCAST_STREAM ?? "broadcast")
    : (process.env.POSTMARK_TRANSACTIONAL_STREAM ?? "outbound");
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN && process.env.POSTMARK_FROM);
}

/**
 * המזהה שאצל Postmark, ואצלנו המפתח לכל מה שיקרה להודעה אחר כך.
 *
 * הוא נשמר על שורת היומן ועל שורת נמען הניוזלטר, ו-webhook הפתיחות מדבר
 * עליו. בלי להחזיר אותו מכאן, דיווח פתיחה שיגיע מחר לא היה שייך לאיש.
 */
export interface SendEmailResult {
  messageId: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  stream = "transactional",
  listUnsubscribeUrl,
}: SendEmailInput): Promise<SendEmailResult> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM;

  if (!token || !from) {
    throw new Error(
      "שליחת מייל לא מוגדרת — חסרים POSTMARK_SERVER_TOKEN או POSTMARK_FROM (ראו README)."
    );
  }

  // כותרת הסרה בלחיצה אחת. שתי הכותרות יחד — בלי השנייה, ספקי הדואר מתייחסים
  // לראשונה כקישור להצגה בלבד ולא כפעולה שהם יכולים לבצע בשם הנמען.
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
      TrackOpens: true,
      // ראו הנימוק בראש הקובץ: הפניה של צד שלישי נכנסת רק לדיוור.
      TrackLinks: stream === "broadcast" ? "HtmlOnly" : "None",
      ...(process.env.POSTMARK_REPLY_TO ? { ReplyTo: process.env.POSTMARK_REPLY_TO } : {}),
      ...(headers ? { Headers: headers } : {}),
    }),
  });

  // Postmark מחזיר 200 עם ErrorCode 0 בהצלחה, ו-4xx עם קוד והסבר בכישלון.
  // שניהם JSON, ולכן הבדיקה על הגוף ולא רק על הסטטוס.
  const result = (await response.json().catch(() => null)) as {
    ErrorCode?: number;
    Message?: string;
    MessageID?: string;
  } | null;

  if (!response.ok || (result?.ErrorCode ?? 0) !== 0) {
    const code = result?.ErrorCode ?? response.status;
    const message = result?.Message ?? response.statusText;
    // 406 = הנמען מסומן inactive אצל Postmark אחרי bounce קשה או תלונת ספאם.
    // ההודעה הגולמית באנגלית לא אומרת את זה למי שקורא את היומן בעברית.
    throw new Error(
      code === 406
        ? `Postmark חוסם שליחה לכתובת הזו (${to}) — היא סומנה כלא פעילה אחרי החזרה או תלונת ספאם.`
        : `Postmark החזיר שגיאה ${code}: ${message}`
    );
  }

  // מחרוזת ריקה ולא זריקה: המייל **נשלח**, ומזהה חסר פוגע רק בסטטיסטיקה.
  // כישלון כאן היה הופך תקלת מדידה לתקלת מסירה, וזה היפוך סדר העדיפויות.
  return { messageId: result?.MessageID ?? "" };
}
