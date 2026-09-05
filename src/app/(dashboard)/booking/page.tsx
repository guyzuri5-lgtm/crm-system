import { ActionForm } from "@/components/action-form";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import { listEventTypes } from "@/lib/booking/data";
import { isCalendarConfigured } from "@/lib/google-calendar";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import type { CSSProperties } from "react";
import { statusToken } from "@/lib/status-colors";
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
      <div className="h-page">
        <div>
          <h1>סוגי פגישות</h1>
          <p>
            לכל סוג פגישה יש קישור ציבורי משלו. שולחים אותו ללקוח, והוא בוחר מועד מתוך השעות
            הפנויות שלך.
          </p>
        </div>
      </div>

      {!isCalendarConfigured() && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: "var(--warn-soft)",
            borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
            color: "var(--warn)",
          }}
        >
          <strong className="font-semibold">יומן גוגל אינו מחובר.</strong> המערכת תציע שעות לפי
          הזמינות שהוגדרה כאן בלבד — בלי לדעת מה כבר תפוס ביומן.
        </div>
      )}

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
            <div className="flex min-w-0 items-center gap-3.5">
              {/* המשך נקרא לפני השם: זה מה שמחפשים כשמחליטים איזה קישור לשלוח. */}
              <span
                className="dur-box"
                style={
                  {
                    "--dur-color": statusToken(eventType.color),
                    "--dur-bg": `color-mix(in srgb, ${statusToken(eventType.color)} 13%, transparent)`,
                  } as CSSProperties
                }
              >
                {eventType.duration_minutes}
                <small>דק׳</small>
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{eventType.name}</h2>
                  {!eventType.active && (
                    <span className="pill">כבוי</span>
                  )}
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--muted)]">
                  <span className="slug" dir="ltr">
                    /book/{eventType.slug}
                  </span>
                  <span>{BOOKING_LOCATION_LABELS[eventType.location]}</span>
                  <span>
                    · הפסקה{" "}
                    {Math.max(eventType.buffer_before_minutes, eventType.buffer_after_minutes)} דק׳
                  </span>
                </p>
              </div>
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
              <ActionForm action={deleteEventTypeAction}>
                <input type="hidden" name="id" value={eventType.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </ActionForm>
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
