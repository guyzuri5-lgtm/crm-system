"use client";

import { useActionState } from "react";
import {
  EVENT_REMINDER_BASIS_LABELS,
  type EventReminder,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import {
  addEventReminderAction,
  deleteEventReminderAction,
  toggleEventReminderAction,
  type EventResult,
} from "../actions";

/**
 * ניהול התזכורות של אירוע.
 *
 * ── למה בוחרים תבנית ולא כותבים טקסט ──
 * מחוץ לחלון 24 השעות מטא שולחת אך ורק תבנית שהיא אישרה, עם הטקסט שאושר.
 * שדה טקסט חופשי כאן היה שקר: בעלת העסק הייתה עורכת אותו, שומרת, והלקוחה
 * הייתה מקבלת משהו אחר לגמרי. לכן מה שנבחר כאן הוא *איזו* תבנית ו*מתי* —
 * שני הדברים שבאמת בשליטת המערכת.
 */

/** רק תבניות שמטא אישרה יכולות לצאת מחוץ לחלון, ולכן רק הן מוצעות. */
function isSendable(template: MessageTemplate): boolean {
  return Boolean(template.meta_template_name) && template.meta_status === "APPROVED";
}

export function EventReminders({
  eventId,
  reminders,
  templates,
}: {
  eventId: string;
  reminders: (EventReminder & { template: MessageTemplate | null })[];
  templates: MessageTemplate[];
}) {
  const [state, formAction, pending] = useActionState<EventResult | null, FormData>(
    async (_prev, formData) => addEventReminderAction(formData),
    null
  );

  const approved = templates.filter(isSendable);

  return (
    <div className="card flex flex-col gap-4">
      <div>
        <h2 className="font-medium">תזכורות בוואטסאפ</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          יוצאות רק למי ששילמה. הטקסט הוא של התבנית המאושרת — כאן בוחרים איזו, ומתי.
        </p>
      </div>

      {reminders.length > 0 && (
        <ul className="flex flex-col gap-2">
          {reminders.map((reminder) => (
            <li
              key={reminder.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {reminder.template?.name ?? "תבנית שנמחקה"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {describeTiming(reminder)}
                  {!reminder.active && " · כבויה"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <form action={toggleEventReminderAction}>
                  <input type="hidden" name="id" value={reminder.id} />
                  <input type="hidden" name="event_id" value={eventId} />
                  <input type="hidden" name="active" value={String(!reminder.active)} />
                  <button type="submit" className="btn-ghost">
                    {reminder.active ? "כיבוי" : "הדלקה"}
                  </button>
                </form>
                <form action={deleteEventReminderAction}>
                  <input type="hidden" name="id" value={reminder.id} />
                  <input type="hidden" name="event_id" value={eventId} />
                  <button type="submit" className="btn-danger">
                    מחיקה
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {approved.length === 0 ? (
        // המצב הזה הוא הרוב כרגע, ולכן הוא מסביר ולא רק מודיע.
        <div className="rounded-xl bg-[var(--nav-amber-soft)] px-4 py-3 text-sm">
          <p className="font-semibold text-[var(--nav-amber)]">אין עדיין תבנית מאושרת</p>
          <p className="mt-1 text-[var(--muted)]">
            מטא מרשה לשלוח למי שלא כתבה לך ב-24 השעות האחרונות רק תבנית שהיא אישרה מראש.
            צור תבנית במסך <span className="font-medium">תבניות הודעה</span>, שלח אותה לאישור,
            וכשהיא תאושר היא תופיע כאן. בתוך הטקסט אפשר להשתמש ב-
            <span dir="ltr" className="font-medium">{" {{event_name}} "}</span>,
            <span dir="ltr" className="font-medium">{" {{event_datetime}} "}</span> ו-
            <span dir="ltr" className="font-medium">{" {{event_location}} "}</span>.
          </p>
        </div>
      ) : (
        <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4">
          <input type="hidden" name="event_id" value={eventId} />

          <label className="field-label min-w-48 flex-1">
            תבנית
            <select name="template_id" required className="input" defaultValue="">
              <option value="" disabled>
                בחרי תבנית…
              </option>
              {approved.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label w-20">
            מתי
            <input name="amount" type="number" min={0} max={1000} defaultValue={1} required className="input" />
          </label>

          <label className="field-label w-28">
            יחידה
            <select name="unit" className="input" defaultValue="days">
              <option value="minutes">דקות</option>
              <option value="hours">שעות</option>
              <option value="days">ימים</option>
            </select>
          </label>

          <label className="field-label w-36">
            ביחס ל־
            <select name="basis" className="input" defaultValue="event">
              <option value="event">לפני האירוע</option>
              <option value="purchase">אחרי הרכישה</option>
            </select>
          </label>

          <button type="submit" className="btn-secondary" disabled={pending}>
            {pending ? "מוסיף…" : "הוספה"}
          </button>

          {state && !state.ok && (
            <p className="w-full text-sm text-[var(--danger)]">{state.error}</p>
          )}
        </form>
      )}
    </div>
  );
}

/** "יום לפני האירוע" · "שעתיים אחרי הרכישה" — במקום ‎-1440 דקות‎. */
function describeTiming(reminder: EventReminder): string {
  const minutes = Math.abs(reminder.offset_minutes);
  const label = EVENT_REMINDER_BASIS_LABELS[reminder.basis];

  if (minutes === 0) return `בזמן ${reminder.basis === "event" ? "האירוע" : "הרכישה"}`;
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, "יום", "ימים")} ${label}`;
  if (minutes % 60 === 0) return `${plural(minutes / 60, "שעה", "שעות")} ${label}`;
  return `${minutes} דקות ${label}`;
}

function plural(value: number, one: string, many: string): string {
  if (value === 1) return one;
  if (value === 2) return one === "יום" ? "יומיים" : "שעתיים";
  return `${value} ${many}`;
}
