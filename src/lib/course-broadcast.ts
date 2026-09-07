import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { sendMessageToContact } from "./send";
import { CONTACT_PLACEHOLDERS, renderTemplate, unresolvedPlaceholders } from "./templates";
import { unsubscribeUrl } from "./newsletter";
import { waIdFromPhone } from "./whatsapp-cloud";
import { isSendingPaused } from "./whatsapp-throttle";
import type {
  Contact,
  CourseBroadcast,
  CourseBroadcastRecipientStatus,
  CourseRow,
  CourseStage,
  MessageChannel,
  MessageTemplate,
} from "./supabase/database.types";

/**
 * שליחה ידנית וחד-פעמית לנרשמי קורס — הכפתור "שליחה לנרשמים" במסך הקורס.
 *
 * ── מה זה *לא* ──
 * לא מסע (שם נכנסים רק "מתעניינים", ולפי תנאי ולא לפי לחיצה), לא כלל
 * אוטומציה (מגיב לסטטוס של איש קשר, שההרשמה לקורס לא נוגעת בו), ולא
 * ניוזלטר (קהל לפי סטטוס, מייל בלבד, ועורך בלוקים). זו הודעה אחת שגיא
 * מחליט לשלוח, לקבוצה שהוא בוחר, עכשיו.
 *
 * ── שני מודלי תוכן, ולמה ──
 * מייל  — כותרת וטקסט שנכתבים בטופס. אין מגבלה, אז אין סיבה לתבנית.
 * וואטסאפ — תבנית מאושרת ב-Meta בלבד. מחוץ לחלון 24 השעות מטא שולחת אך ורק
 *           את הטקסט *שאושר*, ולכן שדה טקסט חופשי כאן היה מציג לגיא משהו
 *           אחד ומוסר ללקוח משהו אחר. אותה מסקנה בדיוק כמו ב-0027.
 */

// ── מי מקבל ───────────────────────────────────────────────────────────────

/**
 * הגדרה אחת של "מי מקבל", שמשרתת גם את המונים שבמסך וגם את תמונת המצב
 * שנוצרת בלחיצה. שתי גרסאות של התנאי הזה היו נפרדות ביום שבו מישהו יוסיף
 * לו סייג — בדיוק הנימוק של audienceQuery בניוזלטר.
 *
 * מי שאינו ניתן להשגה בערוץ הנבחר אינו בקהל, ולכן הוא גם לא נספר. המספר
 * שמופיע ליד הכפתור הוא כמה הודעות באמת ייצאו, לא כמה שורות יש בטבלה.
 */
export function isReachable(contact: Contact, channel: MessageChannel): boolean {
  if (channel === "email") {
    // unsubscribed_at הוא דגל של רשימת התפוצה במייל (קישור ההסרה בפוטר),
    // ולכן הוא חוסם כאן ולא בוואטסאפ. מי שביקשה לרדת מהדיוור ביקשה זאת על
    // מייל, ואין לזה משמעות בערוץ אחר.
    return Boolean(contact.email) && contact.unsubscribed_at === null;
  }
  return Boolean(contact.whatsapp_id ?? waIdFromPhone(contact.phone));
}

type RegistrationWithContact = { stage: CourseStage; contacts: Contact | null };

/** כל מי שרשומה לקורס, עם איש הקשר שלה. הבסיס לספירות ולשליחה כאחד. */
export async function listCourseAudience(
  courseId: string
): Promise<{ stage: CourseStage; contact: Contact }[]> {
  const { data, error } = await supabaseAdmin()
    .from("course_registrations")
    .select("stage, contacts(*)")
    .eq("course_id", courseId)
    .returns<RegistrationWithContact[]>();

  if (error) throw error;

  return (data ?? [])
    .filter((row): row is RegistrationWithContact & { contacts: Contact } =>
      Boolean(row.contacts)
    )
    .map((row) => ({ stage: row.stage, contact: row.contacts }));
}

/**
 * כמה נמענים בכל שלב, לכל ערוץ בנפרד.
 *
 * שני הערוצים נספרים יחד ולא לפי הבחירה הנוכחית, כי המתג בין מייל
 * לוואטסאפ הוא מצב של הלקוח — והמספרים חייבים להתחלף איתו בלי סיבוב נוסף
 * לשרת. שש ספירות זה זול; המתנה של חצי שנייה בכל לחיצה על מתג זה לא.
 */
export type AudienceCounts = Record<MessageChannel, Record<CourseStage, number>>;

export function countByStage(
  audience: { stage: CourseStage; contact: Contact }[]
): AudienceCounts {
  const empty = (): Record<CourseStage, number> => ({ interested: 0, registered: 0, paid: 0 });
  const counts: AudienceCounts = { email: empty(), whatsapp: empty() };

  for (const { stage, contact } of audience) {
    if (isReachable(contact, "email")) counts.email[stage] += 1;
    if (isReachable(contact, "whatsapp")) counts.whatsapp[stage] += 1;
  }
  return counts;
}

/** מזהי אנשי הקשר שיקבלו בפועל — הרשימה שנקפאת ל-course_broadcast_recipients. */
export function selectRecipients(
  audience: { stage: CourseStage; contact: Contact }[],
  stages: CourseStage[],
  channel: MessageChannel
): string[] {
  const chosen = new Set(stages);
  const ids = new Set<string>();

  for (const { stage, contact } of audience) {
    if (chosen.has(stage) && isReachable(contact, channel)) ids.add(contact.id);
  }
  return Array.from(ids);
}

/**
 * האם התבנית יכולה בכלל להישלח לנרשמי קורס.
 *
 * תבנית שיש בה ‎{{booking_time}}‎ או ‎{{event_date}}‎ נראית תקינה ברשימה
 * ונכשלת בזמן השליחה: sendMessageToContact חוסם הודעה שנשארו בה מציינים
 * לא פתורים, ולנרשם לקורס אין פגישה ואין אירוע להחליף אותם. בפועל יש כאן
 * תבנית אחת מאושרת בדיוק — של תזכורות פגישה — כך שבלי הסינון הזה האפשרות
 * *היחידה* בתפריט הייתה זו שמובטח שתיכשל.
 *
 * נבדקים גם הכותרת וגם ה-meta_variables ולא רק הגוף: הם מסלול נפרד לגמרי
 * אל מטא, ומציין שלא הוחלף שם מגיע ללקוח כטקסט גולמי בתוך הודעה מאושרת.
 */
export function usableForCourse(template: MessageTemplate): boolean {
  const text = [template.body, template.subject ?? "", ...template.meta_variables].join(" ");
  return unresolvedPlaceholders(text).every((key) => CONTACT_PLACEHOLDERS.includes(key));
}

// ── המייל ──────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * הטקסט שגיא כתב, עטוף במעטפת מייל.
 *
 * ההברחה כאן היא של הכל, להבדיל מהניוזלטר: שם בלוק הטקסט הוא HTML שנכתב
 * בעורך עשיר ולכן עובר כמו שהוא, וכאן השדה הוא textarea רגילה. מי שמקליד
 * בה ‎<b>‎ מתכוון לסימנים האלה על המסך, לא להדגשה — ובוודאי לא לתגית
 * פתוחה שתבלע את שאר המייל.
 */
export function renderBroadcastHtml(
  broadcast: Pick<CourseBroadcast, "subject" | "body">,
  contact: Contact
): string {
  const subject = escapeHtml(renderTemplate(broadcast.subject ?? "", contact));
  const paragraphs = escapeHtml(renderTemplate(broadcast.body ?? "", contact))
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#1c1a17;">${block.replaceAll("\n", "<br>")}</p>`
    )
    .join("\n");

  // אותה מעטפת של הניוזלטר, ומאותה סיבה: טבלאות ועיצוב inline הם מה שלקוחות
  // דואר באמת מרנדרים.
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
${paragraphs}
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

// ── המנוע ──────────────────────────────────────────────────────────────────

export interface CourseBroadcastSummary {
  sent: number;
  failed: number;
  /** כמה שליחות סיימו את כל הנמענים שלהן בריצה הזו */
  completed: number;
  /** כמה נמענים נשארו לריצה הבאה */
  remaining: number;
  stopped: "paused" | "run_limit" | "time_budget" | null;
  errors: { broadcastId: string; contactId: string; error: string }[];
}

/** תקרת שליחות לריצה אחת — בלימת קצב, כמו בניוזלטר ובתזכורות. */
const MAX_SENDS_PER_RUN = 40;

/** הערכה פסימית למשך שליחה אחת, כדי לא להיקטע באמצע. */
const SEND_ALLOWANCE_MS = 3_000;

type PendingRow = { contact_id: string; contacts: Contact | null };

/**
 * מוציאה את מה שממתין. נקראת מהקרון, באותו דפוס של שאר המנועים: עוצרת
 * מרצון כשנגמר התקציב, ומדווחת כמה נשאר.
 *
 * ── סמנטיקת "לפחות פעם אחת" ──
 * השורה מסומנת sent *אחרי* שליחה מוצלחת, כמו בניוזלטר ולא כמו בתזכורות
 * האירועים (ששם השורה נתפסת לפני). ההבדל אינו שכחה: תזכורת מוגדרת ברגע
 * בזמן, ולכן עדיף שתיעלם מאשר שתגיע פעמיים; הודעה שגיא לחץ לשלוח עדיף
 * שתגיע. קריסה באמצע השליחה המדויקת עלולה אפוא לשלוח שוב לאדם אחד —
 * המחיר המודע של הבחירה הזו.
 */
export async function runCourseBroadcasts(
  now: Date = new Date(),
  budgetMs = 10_000
): Promise<CourseBroadcastSummary> {
  const db = supabaseAdmin();
  const deadline = now.getTime() + budgetMs;

  const summary: CourseBroadcastSummary = {
    sent: 0,
    failed: 0,
    completed: 0,
    remaining: 0,
    stopped: null,
    errors: [],
  };

  // ההשהיה ראשונה, לפני כל שאילתה: כשהמתג דלוק אין מה לשלוף.
  if (await isSendingPaused()) {
    summary.stopped = "paused";
    return summary;
  }

  const { data: due, error } = await db
    .from("course_broadcasts")
    .select("*")
    .eq("status", "sending")
    .order("created_at");

  // טבלה חסרה = 0032 עוד לא רצה. הקרון לא אמור ליפול בגלל זה — שאר המנועים
  // באותה ריצה חייבים להמשיך. אותו דפוס כמו ב-runEventReminders.
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code ?? "")) return summary;
    throw error;
  }
  if (!due?.length) return summary;

  const broadcasts = due as CourseBroadcast[];

  const courseIds = Array.from(new Set(broadcasts.map((b) => b.course_id)));
  const templateIds = Array.from(
    new Set(broadcasts.map((b) => b.template_id).filter((id): id is string => Boolean(id)))
  );

  const [{ data: coursesRaw }, { data: templatesRaw }] = await Promise.all([
    db.from("courses").select("*").in("id", courseIds),
    templateIds.length
      ? db.from("message_templates").select("*").in("id", templateIds)
      : Promise.resolve({ data: [] as MessageTemplate[] }),
  ]);

  const courses = new Map((coursesRaw ?? []).map((c) => [c.id, c as CourseRow]));
  const templates = new Map((templatesRaw ?? []).map((t) => [t.id, t as MessageTemplate]));

  for (const broadcast of broadcasts) {
    if (summary.stopped) break;

    const course = courses.get(broadcast.course_id);
    const template = broadcast.template_id ? templates.get(broadcast.template_id) : null;

    // וואטסאפ בלי התבנית שלו אינו ניתן לשליחה, והמצב הזה חסום פעמיים במסד
    // (מפתח זר עם restrict, ו-check שדורש template_id). חגורה, לא תרחיש.
    if (!course || (broadcast.channel === "whatsapp" && !template)) continue;

    const { data: pending, error: pendingError } = await db
      .from("course_broadcast_recipients")
      .select("contact_id, contacts(*)")
      .eq("broadcast_id", broadcast.id)
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
        // איש קשר שנמחק בין הלחיצה לשליחה. מסומן ולא מדולג, אחרת השליחה
        // לעולם לא תגיע ל-sent ותישאר "יוצאת עכשיו" לנצח.
        await markRecipient(broadcast.id, row.contact_id, "failed", "איש הקשר נמחק");
        summary.failed += 1;
        continue;
      }

      const result =
        broadcast.channel === "email"
          ? await sendMessageToContact({
              contact,
              channel: "email",
              subject: renderTemplate(broadcast.subject ?? "", contact),
              body: renderBroadcastHtml(broadcast, contact),
              logPrefix: `[שליחה לנרשמים: ${course.name}]`,
              // דיוור ולא תפעולי: זו הודעה אחת לרשימה, וזה בדיוק מה
              // ש-Postmark מפריד לטווח IP נפרד — כדי שתלונה כאן לא תפגע
              // במסירה של אישור פגישה. ואיתו מגיעה חובת כותרת ההסרה.
              stream: "broadcast",
              listUnsubscribeUrl: unsubscribeUrl(contact.id),
            })
          : await sendMessageToContact({
              contact,
              channel: "whatsapp",
              // גוף התבנית מרונדר גם כשתצא התבנית המאושרת: מחוץ לחלון הוא
              // מה שנרשם ביומן, כדי שמי שקורא אותו יראה מה הלקוח קיבל.
              body: renderTemplate(template!.body, contact),
              template,
              logPrefix: `[שליחה לנרשמים: ${course.name}]`,
            });

      if (result.ok) {
        await markRecipient(broadcast.id, contact.id, "sent", null);
        summary.sent += 1;
      } else {
        await markRecipient(broadcast.id, contact.id, "failed", result.error);
        summary.failed += 1;
        summary.errors.push({
          broadcastId: broadcast.id,
          contactId: contact.id,
          error: result.error,
        });
      }
    }

    // ── סגירת חשבון ──
    // המונים נכתבים בכל ריצה ולא רק בסוף, כדי שמסך הקורס יראה התקדמות
    // אמיתית בזמן ששליחה גדולה מתפרסת על כמה ריצות.
    const [{ count: stillPending }, { count: sentCount }, { count: failedCount }] =
      await Promise.all([
        countRecipients(broadcast.id, "pending"),
        countRecipients(broadcast.id, "sent"),
        countRecipients(broadcast.id, "failed"),
      ]);

    const { error: finishError } = await db
      .from("course_broadcasts")
      .update({
        status: stillPending ? "sending" : "sent",
        sent_count: sentCount ?? 0,
        failed_count: failedCount ?? 0,
      })
      .eq("id", broadcast.id);
    if (finishError) throw finishError;

    if (stillPending) summary.remaining += stillPending;
    else summary.completed += 1;
  }

  return summary;
}

function countRecipients(broadcastId: string, status: CourseBroadcastRecipientStatus) {
  return supabaseAdmin()
    .from("course_broadcast_recipients")
    .select("contact_id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", status);
}

async function markRecipient(
  broadcastId: string,
  contactId: string,
  status: "sent" | "failed",
  error: string | null
): Promise<void> {
  await supabaseAdmin()
    .from("course_broadcast_recipients")
    .update({ status, error, sent_at: new Date().toISOString() })
    .eq("broadcast_id", broadcastId)
    .eq("contact_id", contactId);
}
