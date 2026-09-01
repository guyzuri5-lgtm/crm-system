import { supabaseAdmin } from "./supabase/admin";
import { sendMessageToContact } from "./send";
import { renderTemplate } from "./templates";
import { SendBudget } from "./whatsapp-throttle";
import type {
  Contact,
  MessageTemplate,
  InteractionType,
  JourneyEntryType,
  JourneyCondition,
} from "./supabase/database.types";

/**
 * מנוע מסעות הלקוח.
 *
 * ההבדל מ-automation-engine הוא לא בגודל אלא באופי: כלל אוטומציה הוא חסר
 * זיכרון — הוא בוחן תנאי ושולח. מסע זוכר איפה כל אדם עומד, וממשיך משם.
 * המצב הזה יושב ב-journey_enrollments, וכל השאר נגזר ממנו.
 *
 * הריצה מחולקת לשניים בכוונה: enroll מוסיף אנשים, advance מקדם אותם. הפרדה
 * זו אומרת שמי שנכנס היום יקבל את השלב הראשון רק בריצה הבאה אם יש לו
 * wait_days — ואם אין, כבר בריצה הזו.
 */

// ── צורות מקומיות ──────────────────────────────────────────────────────────
// תת-קבוצות של השורות המלאות, עם רק מה שהמנוע באמת קורא.

export interface Journey {
  id: string;
  name: string;
  entry_type: JourneyEntryType;
  entry_value: { status?: string } | null;
  active: boolean;
  stop_on_reply: boolean;
}

export interface JourneyStep {
  id: string;
  journey_id: string;
  position: number;
  wait_days: number;
  channel: "whatsapp" | "email";
  template_id: string;
  condition: JourneyCondition;
}

export interface Enrollment {
  id: string;
  journey_id: string;
  contact_id: string;
  next_position: number;
  next_run_at: string;
  state: string;
  enrolled_at: string;
}

export interface JourneyRunSummary {
  enrolled: number;
  sent: number;
  /** שלבים שתנאיהם לא התקיימו ולכן דולגו בלי לשלוח */
  skippedByCondition: number;
  failed: { contactId: string; error: string }[];
  stoppedReplied: number;
  completed: number;
  /** למה הריצה נעצרה לפני שסיימה את כל מי שהיה מועמד */
  stopped: "paused" | "daily_limit" | "time_budget" | null;
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** האינטראקציה שמסמנת כניסה, לכל סוג מסע שאינו מבוסס סטטוס. */
const ENTRY_INTERACTION: Record<Exclude<JourneyEntryType, "status">, InteractionType> = {
  quiz: "quiz_submitted",
  booking: "booking_created",
  course_lead: "course_lead",
};

// ── צירוף ──────────────────────────────────────────────────────────────────

/**
 * מוצא מי עומד בתנאי הכניסה של כל מסע פעיל ועדיין לא צורף, ומצרף.
 *
 * הצירוף נעשה בשאילתה מהקרון ולא בקריאה מהמקום שכותב את הנתונים — אותה גישה
 * שנקט המנוע הקיים, ומאותה סיבה: ארבעה סוגי כניסה היו דורשים ארבע נקודות
 * קריאה מפוזרות, וכל אחת מהן היא מקום שאפשר לשכוח בו לקרוא.
 *
 * ה-unique על (journey_id, contact_id) הוא מה שהופך את זה לבטוח: ריצה חוזרת
 * לא תצרף שוב את מי שכבר צורף, גם אם הוא סיים את המסע מזמן.
 */
async function enrollForJourney(journey: Journey, now: Date): Promise<number> {
  const db = supabaseAdmin();

  let candidateIds: string[] = [];

  if (journey.entry_type === "status") {
    const status = journey.entry_value?.status;
    if (!status) return 0;
    const { data, error } = await db.from("contacts").select("id").eq("status", status);
    if (error) throw error;
    candidateIds = (data ?? []).map((c) => c.id);
  } else {
    const type = ENTRY_INTERACTION[journey.entry_type];
    const { data, error } = await db
      .from("interactions")
      .select("contact_id")
      .eq("type", type)
      .not("contact_id", "is", null);
    if (error) throw error;
    candidateIds = Array.from(new Set((data ?? []).map((i) => i.contact_id).filter(Boolean)));
  }

  if (!candidateIds.length) return 0;

  const { data: existing, error: existingError } = await db
    .from("journey_enrollments")
    .select("contact_id")
    .eq("journey_id", journey.id)
    .in("contact_id", candidateIds);
  if (existingError) throw existingError;

  const already = new Set((existing ?? []).map((e) => e.contact_id));
  const fresh = candidateIds.filter((id) => !already.has(id));
  if (!fresh.length) return 0;

  // ההמתנה של השלב הראשון נספרת מרגע הכניסה. בלי זה מסע שמתחיל ב"חכה יומיים"
  // היה שולח מיד למי שנכנס, כי next_run_at היה now.
  const { data: firstStep } = await db
    .from("journey_steps")
    .select("wait_days")
    .eq("journey_id", journey.id)
    .eq("position", 1)
    .maybeSingle();

  const waitDays = (firstStep as { wait_days: number } | null)?.wait_days ?? 0;
  const nextRunAt = new Date(now.getTime() + waitDays * DAY_MS).toISOString();

  const { error: insertError } = await db.from("journey_enrollments").insert(
    fresh.map((contactId) => ({
      journey_id: journey.id,
      contact_id: contactId,
      next_position: 1,
      next_run_at: nextRunAt,
    }))
  );
  // 23505 = מרוץ בין שתי ריצות. ה-unique עשה את שלו; אין מה לעשות חוץ מלהתעלם.
  if (insertError && insertError.code !== "23505") throw insertError;

  return fresh.length;
}

// ── קידום ──────────────────────────────────────────────────────────────────

/**
 * מריץ את השלב הבא לכל מי שהגיע זמנו.
 *
 * הסדר בתוך הלולאה חשוב: קודם בודקים אם הלקוח ענה (ואז עוצרים), ורק אז
 * מוציאים תקציב שליחה. הפוך מזה, מסע שנעצר ממילא היה "צורך" מכסה יומית.
 */
export async function runJourneys(
  now: Date = new Date(),
  budgetMs = 45_000
): Promise<JourneyRunSummary> {
  const db = supabaseAdmin();
  const budget = await SendBudget.open(budgetMs, now);

  const summary: JourneyRunSummary = {
    enrolled: 0,
    sent: 0,
    skippedByCondition: 0,
    failed: [],
    stoppedReplied: 0,
    completed: 0,
    stopped: null,
    skipped: 0,
  };

  const { data: journeysRaw, error: journeysError } = await db
    .from("journeys")
    .select("*")
    .eq("active", true);
  if (journeysError) throw journeysError;

  const journeys = (journeysRaw ?? []) as unknown as Journey[];
  if (!journeys.length) return summary;

  for (const journey of journeys) {
    summary.enrolled += await enrollForJourney(journey, now);
  }

  const journeyIds = journeys.map((j) => j.id);
  const journeyById = new Map(journeys.map((j) => [j.id, j]));

  const { data: stepsRaw, error: stepsError } = await db
    .from("journey_steps")
    .select("*")
    .in("journey_id", journeyIds)
    .order("position", { ascending: true });
  if (stepsError) throw stepsError;

  const steps = (stepsRaw ?? []) as unknown as JourneyStep[];
  const stepsByJourney = new Map<string, JourneyStep[]>();
  for (const step of steps) {
    const list = stepsByJourney.get(step.journey_id) ?? [];
    list.push(step);
    stepsByJourney.set(step.journey_id, list);
  }

  const { data: dueRaw, error: dueError } = await db
    .from("journey_enrollments")
    .select("*")
    .eq("state", "active")
    .in("journey_id", journeyIds)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(500);
  if (dueError) throw dueError;

  const due = (dueRaw ?? []) as unknown as Enrollment[];
  if (!due.length) return summary;

  const contactIds = Array.from(new Set(due.map((e) => e.contact_id)));
  const [{ data: contactsRaw }, { data: templatesRaw }] = await Promise.all([
    db.from("contacts").select("*").in("id", contactIds),
    db.from("message_templates").select("*"),
  ]);

  const contacts = new Map((contactsRaw ?? []).map((c) => [c.id, c as Contact]));
  const templates = new Map((templatesRaw ?? []).map((t) => [t.id, t as MessageTemplate]));

  for (const enrollment of due) {
    const contact = contacts.get(enrollment.contact_id);
    const step = stepsByJourney
      .get(enrollment.journey_id)
      ?.find((s) => s.position === enrollment.next_position);

    // אין שלב במיקום הזה = המסע נגמר. קורה גם כשמוחקים שלב אחרון בזמן שאנשים
    // באמצע, ולכן זה "הושלם" ולא שגיאה.
    if (!step) {
      await db
        .from("journey_enrollments")
        .update({ state: "completed" })
        .eq("id", enrollment.id);
      summary.completed += 1;
      continue;
    }

    if (!contact) continue;

    const journey = journeyById.get(enrollment.journey_id);
    const replied = Boolean(
      contact.last_incoming_message_at &&
        contact.last_incoming_message_at > enrollment.enrolled_at
    );

    // עצירה ברמת המסע: הלקוח ענה, ואין טעם להמשיך לרדוף אחריו. זה המקרה
    // השכיח, ולכן ברירת המחדל — אבל מכבים אותו כשרוצים מסלול נפרד לעונים.
    if (journey?.stop_on_reply && replied) {
      await db
        .from("journey_enrollments")
        .update({ state: "stopped_replied" })
        .eq("id", enrollment.id);
      summary.stoppedReplied += 1;
      continue;
    }

    // תנאי ברמת השלב: אם אינו מתקיים, מדלגים *מיד* לשלב הבא בלי להמתין
    // שוב. המתנה מחודשת הייתה מזיזה את כל המסלול השני ביום לכל שלב מדולג,
    // וזו לא הכוונה — ההמתנה כבר נספרה כשהגענו הנה.
    if (!conditionHolds(step.condition, replied)) {
      const skipTo = stepsByJourney
        .get(enrollment.journey_id)
        ?.find((s) => s.position === step.position + 1);

      await db
        .from("journey_enrollments")
        .update(
          skipTo
            ? { next_position: skipTo.position, next_run_at: now.toISOString() }
            : { state: "completed" }
        )
        .eq("id", enrollment.id);

      summary.skippedByCondition += 1;
      if (!skipTo) summary.completed += 1;
      continue;
    }

    const template = templates.get(step.template_id);
    if (!template) {
      summary.failed.push({ contactId: contact.id, error: "התבנית של השלב לא נמצאה" });
      continue;
    }

    const throttled = step.channel === "whatsapp";
    if (throttled) {
      const allowed = budget.canSend();
      if (!allowed.ok) {
        // לא break: שלב מייל של מסע אחר אינו מווסת, ואין סיבה לעצור אותו
        // בגלל תקרת הוואטסאפ.
        summary.stopped ??= allowed.reason;
        summary.skipped += 1;
        continue;
      }
    }

    const result = await sendMessageToContact({
      contact,
      channel: step.channel,
      subject:
        step.channel === "email"
          ? renderTemplate(template.subject ?? template.name, contact)
          : undefined,
      body: renderTemplate(template.body, contact),
      template,
      logPrefix: `[${template.name}]`,
    });

    if (!result.ok) {
      summary.failed.push({ contactId: contact.id, error: result.error });
      continue;
    }

    summary.sent += 1;
    if (throttled) budget.countSent();

    // נרשם רק אחרי הצלחה — זה מה שהופך קטיעה באמצע ריצה לבטוחה.
    await db
      .from("journey_step_runs")
      .insert({ enrollment_id: enrollment.id, step_id: step.id });

    const nextStep = stepsByJourney
      .get(enrollment.journey_id)
      ?.find((s) => s.position === step.position + 1);

    await db
      .from("journey_enrollments")
      .update(
        nextStep
          ? {
              next_position: nextStep.position,
              next_run_at: new Date(now.getTime() + nextStep.wait_days * DAY_MS).toISOString(),
            }
          : { state: "completed" }
      )
      .eq("id", enrollment.id);

    if (!nextStep) summary.completed += 1;
  }

  return summary;
}

/**
 * האם השלב רץ עבור איש הקשר הזה.
 *
 * שני שלבים עוקבים עם תנאים הפוכים הם שני מסלולים על אותו טור — וזו
 * ההסתעפות. הצורה הזו נבחרה על פני גרף אמיתי כי היא מכסה את מה שנדרש בפועל
 * ("ענה / לא ענה") בלי להביא איתה עריכת גרף, זיהוי מעגלים וניהול מיקומים.
 */
function conditionHolds(condition: JourneyCondition, replied: boolean): boolean {
  if (condition === "if_replied") return replied;
  if (condition === "if_not_replied") return !replied;
  return true;
}
