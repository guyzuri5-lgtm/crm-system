import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import { listEventTypes } from "@/lib/booking/data";
import { isCalendarConfigured } from "@/lib/google-calendar";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import { statusColorClasses } from "@/lib/status-colors";
import { deleteEventTypeAction } from "./actions";
import { EventTypeForm } from "./event-type-form";
import { CopyLink } from "./copy-link";

export const dynamic = "force-dynamic";

export default async function EventTypesPage() {
  await verifyTeamMember();

  const [eventTypes, statuses] = await Promise.all([listEventTypes(), listStatuses()]);
  const statusNames = statuses.map((s) => s.name);

  return (
    <div className="flex flex-col gap-6">
      {!isCalendarConfigured() && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">יומן גוגל אינו מחובר.</strong> המערכת תציע שעות לפי
          הזמינות שהוגדרה כאן בלבד — בלי לדעת מה כבר תפוס ביומן.
        </div>
      )}

      <p className="text-sm text-[var(--muted)]">
        לכל סוג פגישה יש קישור ציבורי משלו. שלחו אותו ללקוח, והוא בוחר מועד מתוך
        השעות הפנויות שלכם.
      </p>

      {/* ── סוג פגישה חדש ─────────────────────────────────────────── */}
      <details className="card">
        <summary className="cursor-pointer font-medium">+ סוג פגישה חדש</summary>
        <div className="mt-5 border-t border-[var(--border)] pt-5">
          <EventTypeForm statuses={statusNames} />
        </div>
      </details>

      {/* ── הסוגים הקיימים ────────────────────────────────────────── */}
      {eventTypes.map((eventType) => (
        <section key={eventType.id} className="card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{eventType.name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses(eventType.color)}`}
                >
                  {eventType.duration_minutes} דק׳
                </span>
                {!eventType.active && (
                  <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--subtle)]">
                    כבוי
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-[var(--muted)]">
                <span dir="ltr">/book/{eventType.slug}</span>
                {" · "}
                {BOOKING_LOCATION_LABELS[eventType.location]}
                {" · "}
                הפסקה {Math.max(eventType.buffer_before_minutes, eventType.buffer_after_minutes)} דק׳
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <CopyLink path={`/book/${eventType.slug}`} />
              <a
                href={`/book/${eventType.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                תצוגה מקדימה
              </a>
              <form action={deleteEventTypeAction}>
                <input type="hidden" name="id" value={eventType.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </form>
            </div>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-[var(--muted)]">
              עריכת ההגדרות
            </summary>
            <div className="mt-4">
              <EventTypeForm eventType={eventType} statuses={statusNames} />
            </div>
          </details>
        </section>
      ))}

      {!eventTypes.length && (
        <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין סוגי פגישות</p>
      )}
    </div>
  );
}
