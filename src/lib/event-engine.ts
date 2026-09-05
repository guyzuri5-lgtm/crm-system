import "server-only";
import { isSendingPaused } from "@/lib/whatsapp-throttle";

import { supabaseAdmin } from "./supabase/admin";
import { sendMessageToContact } from "./send";
import { renderTemplate } from "./templates";
import type {
  Contact,
  EventReminder,
  EventRow,
  MessageTemplate,
} from "./supabase/database.types";

/**
 * תזכורות לפני אירוע ואחרי רכישה. נקרא מהקרון, באותו דפוס של המנועים
 * הקיימים: עוצר מרצון כשנגמר התקציב, ומדווח מה נשאר.
 *
 * ── מה נשלח בפועל ──
 * תבנית מאושרת ב-Meta, ולא טקסט שנכתב כאן. זה לא היה שיקול עיצובי אלא
 * הכרח: מחוץ לחלון 24 השעות מטא מקבלת אך ורק תבנית מאושרת, ויום לפני
 * האירוע כמעט כל הנרשמות כבר מחוצה לו. הגרסה הראשונה של הקובץ הזה שלחה
 * טקסט חופשי — ולכן פשוט נכשלה בכל פנייה אמיתית.
 *
 * ── מה הופך עצירה באמצע לבטוחה ──
 * שורה ב-event_reminders_sent נכתבת *לפני* השליחה ונמחקת אם היא נכשלה,
 * בדיוק כמו תפיסת הזכות לשלוח את דוח השאלון. המפתח הראשי
 * (registration_id, reminder_id) הוא שהופך את התפיסה לאטומית: שתי ריצות
 * מקבילות, רק אחת תצליח להכניס, ורק היא תשלח.
 */

export interface EventReminderSummary {
  sent: number;
  failed: number;
  stopped: "paused" | "run_limit" | "time_budget" | null;
  errors: { eventId: string; contactId: string; reminderId: string; error: string }[];
}

/** תקרת שליחות לריצה אחת — בלימת קצב, באותו נימוק כמו בניוזלטר. */
const MAX_SENDS_PER_RUN = 40;

/** הערכה פסימית למשך שליחה אחת, כדי לא להיקטע באמצע. */
const SEND_ALLOWANCE_MS = 3_000;

const MINUTE_MS = 60_000;

/**
 * כמה זמן אחרי המועד עוד מותר לשלוח.
 *
 * חלון ולא נקודה, כי הקרון רץ כל רבע שעה ויכול לפספס. אבל גם לא בלי גבול:
 * תזכורת "מחר" שיוצאת שלושה ימים באיחור, אחרי שהקרון היה מושבת, גרועה
 * מתזכורת שלא יצאה. שש שעות מכסות תקלה סבירה ולא יותר מזה.
 */
const GRACE_MS = 6 * 60 * MINUTE_MS;

type PaidRow = {
  id: string;
  contact_id: string;
  paid_at: string | null;
  contacts: Contact | null;
};

export async function runEventReminders(
  now: Date = new Date(),
  budgetMs = 10_000
): Promise<EventReminderSummary> {
  const db = supabaseAdmin();
  const deadline = now.getTime() + budgetMs;

  const summary: EventReminderSummary = { sent: 0, failed: 0, stopped: null, errors: [] };

  // ההשהיה נבדקת ראשונה. תזכורת פגישה יוצאת בוואטסאפ או במייל לפי התבנית,
  // ובשני המקרים היא שליחה אוטומטית — כלומר בדיוק מה שהמתג אמור לעצור.
  if (await isSendingPaused()) {
    summary.stopped = "paused";
    return summary;
  }

  // כל ההגדרות הפעילות, עם האירוע והתבנית שלהן. שאילתה אחת ולא אחת לכל
  // אירוע: מספר ההגדרות קטן מטבעו, וזה חוסך סיבוב לכל אירוע פעיל.
  const { data: reminders, error } = await db
    .from("event_reminders")
    .select("*")
    .eq("active", true);

  // טבלה חסרה = 0027 עוד לא רץ. הקרון לא אמור ליפול בגלל זה — שאר המנועים
  // באותה ריצה חייבים להמשיך.
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code ?? "")) return summary;
    throw error;
  }
  if (!reminders?.length) return summary;

  const eventIds = Array.from(new Set(reminders.map((r) => r.event_id)));
  const templateIds = Array.from(new Set(reminders.map((r) => r.template_id)));

  const [{ data: eventsRaw }, { data: templatesRaw }] = await Promise.all([
    db.from("events").select("*").in("id", eventIds).eq("active", true),
    db.from("message_templates").select("*").in("id", templateIds),
  ]);

  const events = new Map((eventsRaw ?? []).map((e) => [e.id, e as EventRow]));
  const templates = new Map((templatesRaw ?? []).map((t) => [t.id, t as MessageTemplate]));

  for (const reminder of reminders as EventReminder[]) {
    if (summary.stopped) break;

    const event = events.get(reminder.event_id);
    const template = templates.get(reminder.template_id);
    // אירוע שכובה, או תבנית שנמחקה: מדלגים בשקט. ה-restrict על המפתח הזר
    // אמור למנוע את השני, וזו חגורה נוספת.
    if (!event || !template) continue;

    // רק מי ששילמה. מתעניינת שלא סגרה לא אמורה לקבל "נתראה מחר", ובבסיס
    // purchase ממילא אין לה paid_at לספור ממנו.
    const { data: paid, error: paidError } = await db
      .from("event_registrations")
      .select("id, contact_id, paid_at, contacts(*)")
      .eq("event_id", event.id)
      .eq("stage", "paid")
      .returns<PaidRow[]>();
    if (paidError) throw paidError;

    for (const row of paid ?? []) {
      if (summary.sent + summary.failed >= MAX_SENDS_PER_RUN) {
        summary.stopped ??= "run_limit";
        break;
      }
      if (Date.now() + SEND_ALLOWANCE_MS > deadline) {
        summary.stopped ??= "time_budget";
        break;
      }

      const contact = row.contacts;
      if (!contact) continue; // איש הקשר נמחק בין השאילתות

      const dueAt = reminderDueAt(reminder, event, row.paid_at);
      if (!dueAt) continue;

      const lateBy = now.getTime() - dueAt.getTime();
      if (lateBy < 0 || lateBy > GRACE_MS) continue;

      // ── תפיסת הזכות לשלוח ──
      const { error: claimError } = await db
        .from("event_reminders_sent")
        .insert({ registration_id: row.id, reminder_id: reminder.id });
      // 23505 = כבר נשלחה, או שריצה מקבילה הקדימה. שתיהן "לא שלנו", ולכן
      // המשך שקט ולא שגיאה.
      if (claimError) {
        if (claimError.code === "23505") continue;
        throw claimError;
      }

      const result = await sendMessageToContact({
        contact,
        channel: template.channel,
        subject: template.subject
          ? renderTemplate(template.subject, contact, null, event)
          : undefined,
        // הגוף מרונדר גם כשתישלח תבנית מאושרת: מחוץ לחלון הוא מה שנרשם
        // ביומן, כדי שמי שקוראת אותו תראה מה הלקוחה קיבלה בפועל.
        body: renderTemplate(template.body, contact, null, event),
        template,
        event,
        logPrefix: `[תזכורת: ${template.name}]`,
      });

      if (result.ok) {
        summary.sent += 1;
      } else {
        // שחרור התפיסה, כדי שהריצה הבאה תנסה שוב כל עוד החלון פתוח.
        await db
          .from("event_reminders_sent")
          .delete()
          .eq("registration_id", row.id)
          .eq("reminder_id", reminder.id);
        summary.failed += 1;
        summary.errors.push({
          eventId: event.id,
          contactId: contact.id,
          reminderId: reminder.id,
          error: result.error,
        });
      }
    }
  }

  return summary;
}

/**
 * מתי התזכורת הזו אמורה לצאת לנרשמת הזו.
 *
 * בבסיס event זה אותו רגע לכולן; בבסיס purchase לכל אחת שעון משלה, שמתחיל
 * ברגע התשלום. רשומה שסומנה כשילמה ידנית לפני שהעמודה מולאה מחזירה null —
 * אין ממה לספור, ועדיף לא לשלוח מאשר לשלוח במועד שהומצא.
 */
export function reminderDueAt(
  reminder: Pick<EventReminder, "basis" | "offset_minutes">,
  event: Pick<EventRow, "starts_at">,
  paidAt: string | null
): Date | null {
  const anchor = reminder.basis === "event" ? event.starts_at : paidAt;
  if (!anchor) return null;

  const base = new Date(anchor).getTime();
  if (Number.isNaN(base)) return null;

  return new Date(base + reminder.offset_minutes * MINUTE_MS);
}
