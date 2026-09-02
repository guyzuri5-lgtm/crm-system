import { stepDueAt, wallClockToUtc } from "@/lib/journey-engine";
import { renderTemplate } from "@/lib/templates";
import {
  JOURNEY_CONDITION_LABELS,
  type Contact,
  type Booking,
  type JourneyStep,
  type JourneyEdge,
  type MessageTemplate,
} from "@/lib/supabase/database.types";

/**
 * "הצג מסע לדוגמה" — הבדיקה האחרונה לפני שמדליקים מסע.
 *
 * הפעלת מסע היא חד-כיוונית, ולכן לפני שמדליקים צריך לראות לא ציור של גרף
 * אלא את מה שהלקוח באמת יקבל: אילו הודעות, באילו תאריכים, עם איזה תוכן.
 * הסימולציה מריצה לקוחה בדויה (דנה כהן, פגישה ביום רביעי הקרוב ב-11:15)
 * דרך אותן פונקציות בדיוק שהמנוע האמיתי משתמש בהן — stepDueAt לזמנים
 * ו-renderTemplate לתוכן — כך שאין לה דרך להציג משהו שהמנוע לא יעשה.
 *
 * רכיב שרת בתוך <details>: נפתח ונסגר בלי JavaScript, ומחושב מחדש בכל
 * טעינה כך שהתאריכים תמיד ביחס להיום.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const SAMPLE_CONTACT = {
  full_name: "דנה כהן",
  phone: "050-1234567",
  email: "dana@example.com",
  status: "מתעניין",
} as unknown as Contact;

/** פגישה בדויה: יום רביעי הקרוב ב-11:15, בשעון ישראל. */
function sampleBooking(): Booking {
  const base = new Date();
  base.setTime(base.getTime() + ((((3 - base.getDay() + 7) % 7) || 7) * DAY_MS));
  const startsAt = wallClockToUtc(base, 0, 11 * 60 + 15, "Asia/Jerusalem");
  return {
    starts_at: startsAt.toISOString(),
    invitee_timezone: "Asia/Jerusalem",
    google_meet_url: "https://meet.google.com/abc-demo",
  } as unknown as Booking;
}

interface SimItem {
  step: JourneyStep;
  template: MessageTemplate | null;
  due: Date | null;
  conditionLabel: string | null;
}

/**
 * הליכה על הגרף מהכניסה, בדיוק כמו שאדם אמיתי היה עובר בו.
 *
 * כל כרטיסייה מחושבת פעם אחת, מהקשת הראשונה שמגיעה אליה (זו שהמנוע היה
 * בוחר). התוצאה ממוינת לפי זמן — ציר זמן, לא רשימת צמתים. כרטיסייה שלא
 * מחוברת לכניסה לא תופיע, וזה נכון: היא גם לא תישלח.
 */
function simulate(
  steps: JourneyStep[],
  edges: JourneyEdge[],
  templates: MessageTemplate[],
  booking: Booking | null,
  enrolledAt: Date
): SimItem[] {
  const stepById = new Map(steps.map((s) => [s.id, s]));
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const outgoing = new Map<string | null, JourneyEdge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.from_step_id) ?? [];
    list.push(e);
    outgoing.set(e.from_step_id, list);
  }

  const items: SimItem[] = [];
  const visited = new Set<string>();
  const queue = (outgoing.get(null) ?? []).map((e) => ({
    stepId: e.to_step_id,
    from: enrolledAt,
    condition: e.condition,
  }));

  while (queue.length) {
    const { stepId, from, condition } = queue.shift()!;
    if (visited.has(stepId)) continue;
    visited.add(stepId);

    const step = stepById.get(stepId);
    if (!step) continue;

    const due = stepDueAt(step, {
      now: from,
      booking: booking
        ? { starts_at: booking.starts_at, invitee_timezone: booking.invitee_timezone ?? "Asia/Jerusalem" }
        : null,
    });

    items.push({
      step,
      template: templateById.get(step.template_id) ?? null,
      due,
      conditionLabel: condition !== "always" ? JOURNEY_CONDITION_LABELS[condition] : null,
    });

    for (const e of outgoing.get(stepId) ?? []) {
      queue.push({ stepId: e.to_step_id, from: due ?? from, condition: e.condition });
    }
  }

  items.sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
  return items;
}

function formatDue(due: Date): string {
  return due.toLocaleString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

export function JourneySimulation({
  steps,
  edges,
  templates,
  bookingEntry,
}: {
  steps: JourneyStep[];
  edges: JourneyEdge[];
  templates: MessageTemplate[];
  bookingEntry: boolean;
}) {
  if (!steps.length) return null;

  const booking = bookingEntry ? sampleBooking() : null;
  const enrolledAt = new Date();
  const items = simulate(steps, edges, templates, booking, enrolledAt);
  const disconnected = steps.length - items.length;

  return (
    <details className="card">
      <summary className="cursor-pointer font-medium">
        הצג מסע לדוגמה
        <span className="mr-2 text-sm font-normal text-[var(--muted)]">
          — מה תקבל לקוחה בדויה, מתי, ועם איזה תוכן
        </span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-[var(--muted)]">
          הלקוחה: <strong>דנה כהן</strong>, מצטרפת למסע עכשיו
          {booking && (
            <>
              , עם פגישה ב
              <strong>{formatDue(new Date(booking.starts_at))}</strong>
            </>
          )}
          . הזמנים והתוכן מחושבים באותו קוד שישלח את ההודעות האמיתיות.
        </p>

        <ol className="flex flex-col gap-3 border-r-2 border-[var(--border)] pr-4">
          {items.map(({ step, template, due, conditionLabel }) => (
            <li key={step.id} className="relative">
              <span className="absolute -right-[1.45rem] top-1.5 size-2.5 rounded-full bg-[var(--primary)]" />
              <p className="text-sm font-medium">
                {due ? formatDue(due) : "לא יישלח — אין פגישה לעגן אליה"}
                <span
                  className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-normal ${
                    step.channel === "email"
                      ? "bg-sky-100 text-sky-800"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {step.channel === "email" ? "מייל" : "וואטסאפ"}
                </span>
                {conditionLabel && (
                  <span className="mr-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-normal text-amber-700">
                    {conditionLabel}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-[var(--subtle)]">
                {step.label || template?.name || "כרטיסייה"}
              </p>
              <p
                className={`mt-1.5 max-w-xl rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  step.channel === "email" ? "bg-sky-50" : "bg-emerald-50"
                }`}
              >
                {template
                  ? renderTemplate(template.body, SAMPLE_CONTACT, booking)
                  : "התבנית נמחקה — הכרטיסייה לא תישלח"}
              </p>
            </li>
          ))}
        </ol>

        {disconnected > 0 && (
          <p className="text-xs text-[var(--danger)]">
            {disconnected === 1
              ? "כרטיסייה אחת לא מחוברת לכניסה ולכן לא מופיעה כאן — היא גם לא תישלח."
              : `${disconnected} כרטיסיות לא מחוברות לכניסה ולכן לא מופיעות כאן — הן גם לא יישלחו.`}
          </p>
        )}
      </div>
    </details>
  );
}
