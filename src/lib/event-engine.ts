import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { sendMessageToContact } from "./send";
import { formatTime } from "./booking/timezone";
import { EVENT_TIMEZONE } from "./events";
import type { Contact, EventReminderKind, EventRow } from "./supabase/database.types";

/**
 * תזכורות לפני אירוע. נקרא מהקרון, באותו דפוס של המנועים הקיימים: עוצר
 * מרצון כשנגמר התקציב, ומדווח מה נשאר.
 *
 * ── מה הופך עצירה באמצע לבטוחה ──
 * שורה ב-event_reminders_sent נכתבת *לפני* השליחה ולא אחריה, בדיוק כמו
 * תפיסת הזכות לשלוח את דוח השאלון (webhooks/quiz/route.ts). המפתח הראשי
 * (registration_id, kind) הוא שהופך את התפיסה לאטומית: שתי ריצות מקבילות,
 * רק אחת תצליח להכניס, ורק היא תשלח. אם השליחה נכשלת השורה נמחקת, כך
 * שהריצה הבאה תנסה שוב כל עוד החלון פתוח.
 */

export interface EventReminderSummary {
  sent: number;
  failed: number;
  stopped: "run_limit" | "time_budget" | null;
  errors: { eventId: string; contactId: string; kind: EventReminderKind; error: string }[];
}

/** תקרת שליחות לריצה אחת — בלימת קצב, באותו נימוק כמו בניוזלטר. */
const MAX_SENDS_PER_RUN = 40;

/** הערכה פסימית למשך שליחה אחת, כדי לא להיקטע באמצע. */
const SEND_ALLOWANCE_MS = 3_000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * החלונות שבהם כל תזכורת רלוונטית.
 *
 * הם רחבים ולא נקודתיים כי הקרון רץ כל רבע שעה: חלון של "בדיוק 24 שעות"
 * היה מוחמץ בכל פעם שהריצה נופלת דקה אחרי. הרוחב לא מסכן בכפילות — על כך
 * אחראית שורת ה-event_reminders_sent, לא דיוק החלון.
 */
const WINDOWS: Record<EventReminderKind, { fromMs: number; toMs: number }> = {
  day_before: { fromMs: 20 * HOUR_MS, toMs: 28 * HOUR_MS },
  hour_before: { fromMs: 50 * 60_000, toMs: 70 * 60_000 },
};

type PaidRow = { id: string; contact_id: string; contacts: Contact | null };

export async function runEventReminders(
  now: Date = new Date(),
  budgetMs = 10_000
): Promise<EventReminderSummary> {
  const db = supabaseAdmin();
  const deadline = now.getTime() + budgetMs;

  const summary: EventReminderSummary = { sent: 0, failed: 0, stopped: null, errors: [] };

  // החלון הרחב ביותר שיכול להיות רלוונטי, בשאילתה אחת. הסינון המדויק לכל
  // סוג תזכורת נעשה אחריה בזיכרון.
  const { data: events, error } = await db
    .from("events")
    .select("*")
    .eq("active", true)
    .gte("starts_at", new Date(now.getTime() + WINDOWS.hour_before.fromMs).toISOString())
    .lte("starts_at", new Date(now.getTime() + WINDOWS.day_before.toMs).toISOString())
    .order("starts_at");

  // טבלה חסרה = 0024 עוד לא רץ. הקרון לא אמור ליפול בגלל זה — שאר המנועים
  // באותה ריצה חייבים להמשיך.
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code ?? "")) return summary;
    throw error;
  }

  for (const event of (events ?? []) as EventRow[]) {
    if (summary.stopped) break;

    const untilStart = new Date(event.starts_at).getTime() - now.getTime();

    for (const kind of ["day_before", "hour_before"] as const) {
      if (summary.stopped) break;

      const enabled = kind === "day_before" ? event.remind_day_before : event.remind_hour_before;
      if (!enabled) continue;

      const window = WINDOWS[kind];
      if (untilStart < window.fromMs || untilStart > window.toMs) continue;

      // רק מי ששילמה. מתעניינת שלא סגרה לא אמורה לקבל "נתראה מחר".
      const { data: paid, error: paidError } = await db
        .from("event_registrations")
        .select("id, contact_id, contacts(*)")
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

        // ── תפיסת הזכות לשלוח ──
        const { error: claimError } = await db
          .from("event_reminders_sent")
          .insert({ registration_id: row.id, kind });
        // 23505 = כבר נשלחה, או שריצה מקבילה הקדימה. שתיהן "לא שלנו", ולכן
        // המשך שקט ולא שגיאה.
        if (claimError) {
          if (claimError.code === "23505") continue;
          throw claimError;
        }

        const result = await sendMessageToContact({
          contact,
          channel: "whatsapp",
          body: reminderText(event, kind),
          logPrefix: kind === "day_before" ? "[תזכורת יום לפני]" : "[תזכורת שעה לפני]",
        });

        if (result.ok) {
          summary.sent += 1;
        } else {
          // שחרור התפיסה, כדי שהריצה הבאה תנסה שוב כל עוד החלון פתוח.
          await db
            .from("event_reminders_sent")
            .delete()
            .eq("registration_id", row.id)
            .eq("kind", kind);
          summary.failed += 1;
          summary.errors.push({
            eventId: event.id,
            contactId: contact.id,
            kind,
            error: result.error,
          });
        }
      }
    }
  }

  return summary;
}

/** "תזכורת: ערב ריפוי בצלילים מחר ב-19:00, סטודיו הרצל 5. נתראה!" */
function reminderText(event: EventRow, kind: EventReminderKind): string {
  const when = kind === "day_before" ? "מחר" : "בעוד שעה";
  const time = formatTime(new Date(event.starts_at), EVENT_TIMEZONE);
  const place = event.location ? `, ${event.location}` : "";
  return `תזכורת: ${event.name} ${when} ב-${time}${place}. נתראה!`;
}
