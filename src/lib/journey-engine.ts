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
  StepTiming,
  Booking,
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
  wait_days: number;
  channel: "whatsapp" | "email";
  template_id: string;
  offset_minutes: number;
  label: string | null;
  timing: StepTiming;
  day_offset: number;
  day_at_minutes: number;
}

/** התנאי יושב על הקשת ולא על הצומת — זה מה שמאפשר שני מסלולים מאותו שלב. */
export interface JourneyEdge {
  id: string;
  journey_id: string;
  from_step_id: string | null;
  to_step_id: string;
  condition: JourneyCondition;
  priority: number;
}

export interface Enrollment {
  id: string;
  journey_id: string;
  contact_id: string;
  current_step_id: string | null;
  steps_taken: number;
  next_run_at: string;
  state: string;
  enrolled_at: string;
  booking_id: string | null;
}

export interface JourneyRunSummary {
  enrolled: number;
  sent: number;
  /** צירופים שהגיעו לצומת בלי קשת יוצאת שמתאימה להם */
  deadEnded: number;
  failed: { contactId: string; error: string }[];
  stoppedReplied: number;
  completed: number;
  /** למה הריצה נעצרה לפני שסיימה את כל מי שהיה מועמד */
  stopped: "paused" | "daily_limit" | "time_budget" | null;
  skipped: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * תקרת שלבים לצירוף אחד.
 *
 * בטור היה סוף מובנה — השלב האחרון. בגרף אפשר לכתוב מעגל, בטעות או בכוונה,
 * וללא התקרה הזו לקוח אחד היה מקבל הודעה בכל ריצה לנצח. המספר נדיב מספיק
 * שמסע לגיטימי לא ייתקל בו, ונמוך מספיק שטעות תיעצר תוך יום-יומיים.
 */
const MAX_STEPS_PER_ENROLLMENT = 50;

/**
 * ההיסט של אזור זמן ברגע נתון, במילישניות.
 *
 * ‎Date‎ מכיר רק UTC ואת אזור הזמן של השרת, ואנחנו צריכים שעון של לקוח
 * במקום אחר. הדרך היחידה בלי ספרייה: לפרמט את הרגע באזור המבוקש, לקרוא את
 * החלקים בחזרה כאילו היו UTC, וההפרש הוא ההיסט. עובד גם על מעברי שעון קיץ,
 * כי ההיסט נמדד ברגע עצמו ולא בכלל קבוע.
 */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .reduce<Record<string, number>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = Number(p.value);
      return acc;
    }, {});

  // hour24 מגיע כ-24 בחצות אצל חלק מהמנועים; Date.UTC מגלגל את זה נכון.
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - at.getTime();
}

/** שעה מסוימת ביום מסוים, בשעון של הלקוח → הרגע המוחלט. */
export function wallClockToUtc(
  base: Date,
  dayOffset: number,
  minutesFromMidnight: number,
  timeZone: string
): Date {
  // התאריך של הפגישה כפי שהלקוח רואה אותו — לא כפי שהשרת רואה.
  const local = new Date(base.getTime() + tzOffsetMs(base, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate() + dayOffset;

  const guess = Date.UTC(y, m, d, Math.floor(minutesFromMidnight / 60), minutesFromMidnight % 60);
  // ההיסט נמדד סביב הניחוש עצמו, כדי שיום שחוצה מעבר שעון ייצא נכון.
  return new Date(guess - tzOffsetMs(new Date(guess), timeZone));
}

/**
 * מתי הכרטיסייה אמורה לרוץ.
 *
 * שלושת הסוגים נבדלים בנקודת הייחוס: הקודמת, הפגישה כמרחק, או הפגישה כיום
 * שיש בו שעה. כרטיסייה שמעוגנת לפגישה בלי פגישה מחזירה null, והמנוע מדלג
 * עליה — עדיף לדלג על תזכורת מאשר לשלוח אותה בזמן שרירותי.
 *
 * מיוצאת גם ל"הצג מסע לדוגמה": הסימולציה חייבת לחשב עם אותה פונקציה בדיוק,
 * אחרת היא מציגה זמנים שהמנוע לא באמת ישלח בהם.
 */
export function stepDueAt(
  step: {
    timing: StepTiming;
    wait_days: number;
    offset_minutes: number;
    day_offset: number;
    day_at_minutes: number;
  },
  from: { now: Date; booking: { starts_at: string; invitee_timezone: string } | null }
): Date | null {
  if (step.timing === "relative") {
    return new Date(from.now.getTime() + step.wait_days * DAY_MS);
  }

  if (!from.booking) return null;
  const startsAt = new Date(from.booking.starts_at);
  const tz = from.booking.invitee_timezone || "Asia/Jerusalem";

  if (step.timing === "booking_offset") {
    return new Date(startsAt.getTime() + step.offset_minutes * MINUTE_MS);
  }

  return wallClockToUtc(startsAt, step.day_offset, step.day_at_minutes, tz);
}

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

  // דרישת הפגישה נגזרת מהשלבים ולא מהמסע: אם יש בו ולו כרטיסייה אחת שמעוגנת
  // לפגישה, אין טעם לצרף מי שאין לו אחת — הוא ייתקע על אותה כרטיסייה.
  const { data: timings } = await db
    .from("journey_steps")
    .select("timing")
    .eq("journey_id", journey.id);
  const needsBooking = (timings ?? []).some(
    (t) => (t as { timing: string }).timing !== "relative"
  );

  const bookingByContact = new Map<string, Booking>();
  if (needsBooking || journey.entry_type === "booking") {
    const { data: upcoming, error: bookingError } = await db
      .from("bookings")
      .select("*")
      .in("contact_id", candidateIds.length ? candidateIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("status", "confirmed")
      .gt("starts_at", now.toISOString())
      .order("starts_at", { ascending: true });
    if (bookingError) throw bookingError;

    // הראשונה לכל איש קשר היא הקרובה ביותר, כי המיון עולה.
    for (const booking of (upcoming ?? []) as Booking[]) {
      if (booking.contact_id && !bookingByContact.has(booking.contact_id)) {
        bookingByContact.set(booking.contact_id, booking);
      }
    }
    candidateIds = candidateIds.filter((id) => bookingByContact.has(id));
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

  // הצומת הראשון הוא היעד של הקשת שיוצאת מהכניסה. מסע בלי קשת כזו הוא מסע
  // שיש בו כרטיסיות אבל אף אחת מהן אינה מחוברת להתחלה — ואין לאן לצרף.
  const { data: entryEdges } = await db
    .from("journey_edges")
    .select("to_step_id, priority")
    .eq("journey_id", journey.id)
    .is("from_step_id", null)
    .order("priority", { ascending: true })
    .limit(1);

  const firstStepId = (entryEdges ?? [])[0]?.to_step_id;
  if (!firstStepId) return 0;

  const { data: firstStep } = await db
    .from("journey_steps")
    .select("*")
    .eq("id", firstStepId)
    .maybeSingle();

  const step = (firstStep as JourneyStep | null) ?? {
    timing: "relative" as StepTiming,
    wait_days: 0,
    offset_minutes: 0,
    day_offset: 0,
    day_at_minutes: 540,
  };

  const { error: insertError } = await db.from("journey_enrollments").insert(
    fresh.map((contactId) => {
      const booking = bookingByContact.get(contactId) ?? null;
      const due =
        stepDueAt(step, { now, booking }) ?? now;

      return {
        journey_id: journey.id,
        contact_id: contactId,
        booking_id: booking?.id ?? null,
        current_step_id: firstStepId,
        next_run_at: due.toISOString(),
      };
    })
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
    deadEnded: 0,
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
    ;
  if (stepsError) throw stepsError;

  const steps = (stepsRaw ?? []) as unknown as JourneyStep[];
  const stepById = new Map(steps.map((s) => [s.id, s]));

  const { data: edgesRaw, error: edgesError } = await db
    .from("journey_edges")
    .select("*")
    .in("journey_id", journeyIds)
    .order("priority", { ascending: true });
  if (edgesError) throw edgesError;

  // קשתות לפי צומת המוצא, כבר ממוינות לפי priority — הראשונה שתנאיה
  // מתקיימים היא זו שנבחרת.
  const edgesFrom = new Map<string, JourneyEdge[]>();
  for (const edge of (edgesRaw ?? []) as unknown as JourneyEdge[]) {
    const key = edge.from_step_id ?? "__entry__";
    const list = edgesFrom.get(key) ?? [];
    list.push(edge);
    edgesFrom.set(key, list);
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
  const bookingIds = Array.from(
    new Set(due.map((e) => e.booking_id).filter((id): id is string => Boolean(id)))
  );

  const [{ data: contactsRaw }, { data: templatesRaw }, { data: bookingsRaw }] =
    await Promise.all([
      db.from("contacts").select("*").in("id", contactIds),
      db.from("message_templates").select("*"),
      bookingIds.length
        ? db.from("bookings").select("*").in("id", bookingIds)
        : Promise.resolve({ data: [] as Booking[] }),
    ]);

  const contacts = new Map((contactsRaw ?? []).map((c) => [c.id, c as Contact]));
  const templates = new Map((templatesRaw ?? []).map((t) => [t.id, t as MessageTemplate]));
  const bookings = new Map((bookingsRaw ?? []).map((b) => [b.id, b as Booking]));

  for (const enrollment of due) {
    const contact = contacts.get(enrollment.contact_id);
    const step = enrollment.current_step_id ? stepById.get(enrollment.current_step_id) : undefined;

    // הצומת נמחק בזמן שמישהו עמד עליו. זה "הושלם" ולא שגיאה — עריכת מסע
    // פעיל היא פעולה לגיטימית, ומי שנתקע אמצע לא צריך להיתקע לנצח.
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
    const rawBooking = enrollment.booking_id ? (bookings.get(enrollment.booking_id) ?? null) : null;

    // שתי הבחנות שנראות זהות ואינן:
    //
    // booking       — לרינדור. גם פגישה שכבר עברה שווה להזכיר בהודעת מעקב.
    // anchorBooking — לתזמון. פגישה שבוטלה או שכבר התחילה אינה יכולה לעגן
    //                 תזכורת "לפני", וכרטיסייה כזו תדולג.
    //
    // הגרסה הקודמת סיימה את המסע *כולו* כשהפגישה עברה. עם תזמון ברמת
    // הכרטיסייה זה שגוי: מייל מעקב אחרי הפגישה הוא בדיוק מה שאמור לרוץ אז.
    const booking = rawBooking && rawBooking.status === "confirmed" ? rawBooking : null;
    const anchorBooking =
      booking && new Date(booking.starts_at).getTime() > now.getTime() ? booking : null;

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

    // חגורת המעגלים. צירוף שעבר את התקרה כמעט בוודאות נמצא בלולאה שנכתבה
    // בטעות, ועדיף לעצור אותו מאשר לשלוח ללקוח הודעה בכל ריצה לנצח.
    if (enrollment.steps_taken >= MAX_STEPS_PER_ENROLLMENT) {
      await db
        .from("journey_enrollments")
        .update({ state: "completed" })
        .eq("id", enrollment.id);
      summary.completed += 1;
      continue;
    }

    // כרטיסייה שמעוגנת לפגישה, ואין פגישה. לשלוח אותה בזמן שרירותי גרוע
    // מלדלג עליה — "תזכורת לפגישה" בלי פגישה היא הודעה חסרת פשר.
    if (step.timing !== "relative" && !anchorBooking) {
      const skipEdges = edgesFrom.get(step.id) ?? [];
      const skipTo = skipEdges.find((e) => conditionHolds(e.condition, replied));
      const skipStep = skipTo ? stepById.get(skipTo.to_step_id) : undefined;

      await db
        .from("journey_enrollments")
        .update(
          skipStep
            ? {
                current_step_id: skipStep.id,
                steps_taken: enrollment.steps_taken + 1,
                next_run_at: (
                  stepDueAt(skipStep, { now, booking: anchorBooking }) ?? now
                ).toISOString(),
              }
            : { state: "completed" }
        )
        .eq("id", enrollment.id);

      if (!skipStep) summary.completed += 1;
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
          ? renderTemplate(template.subject ?? template.name, contact, booking)
          : undefined,
      body: renderTemplate(template.body, contact, booking),
      template,
      booking,
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

    // הקשת הראשונה שתנאיה מתקיימים זוכה. קשתות ממוינות לפי priority, ולכן
    // 'always' שיושבת ראשונה תבלע את כל השאר — וזה מה שהממשק מזהיר עליו.
    const outgoing = edgesFrom.get(step.id) ?? [];
    const taken = outgoing.find((e) => conditionHolds(e.condition, replied));
    const nextStep = taken ? stepById.get(taken.to_step_id) : undefined;

    await db
      .from("journey_enrollments")
      .update(
        nextStep
          ? {
              current_step_id: nextStep.id,
              steps_taken: enrollment.steps_taken + 1,
              // כרטיסייה שמעוגנת לפגישה בלי פגישה מקבלת now, כלומר תרוץ
              // בריצה הבאה ותדולג שם — ולא נתקעת לנצח.
              next_run_at: (
                stepDueAt(nextStep, { now, booking: anchorBooking }) ?? now
              ).toISOString(),
            }
          : { state: "completed", steps_taken: enrollment.steps_taken + 1 }
      )
      .eq("id", enrollment.id);

    // אין קשת יוצאת שמתאימה — סוף מסלול. זה תקין לגמרי (קצה של ענף), אבל
    // כשזה קורה להרבה אנשים זה בדרך כלל קשת שנשכחה, ולכן נספר בנפרד.
    if (!nextStep) {
      summary.completed += 1;
      if (outgoing.length > 0) summary.deadEnded += 1;
    }
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
