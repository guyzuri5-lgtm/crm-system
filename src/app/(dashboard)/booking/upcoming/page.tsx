import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings, listEventTypes } from "@/lib/booking/data";
import { formatDateTime } from "@/lib/booking/timezone";
import { isCalendarConfigured } from "@/lib/google-calendar";
import { statusColorClasses } from "@/lib/status-colors";
import { cancelBookingAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function UpcomingPage() {
  await verifyTeamMember();

  const [eventTypes, settings] = await Promise.all([listEventTypes(), getBookingSettings()]);

  const { data: bookings } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(100);

  const eventTypeById = new Map(eventTypes.map((type) => [type.id, type]));
  const calendarConnected = isCalendarConfigured();

  if (!bookings?.length) {
    return <p className="px-1 text-sm text-[var(--subtle)]">אין פגישות קרובות</p>;
  }

  return (
    <div className="table-wrap">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="th">מתי</th>
            <th className="th">סוג</th>
            <th className="th">עם מי</th>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => {
            const eventType = eventTypeById.get(booking.event_type_id);
            return (
              <tr key={booking.id} className="tr-hover border-b border-[var(--border)] last:border-0">
                <td className="td whitespace-nowrap">
                  {formatDateTime(new Date(booking.starts_at), settings.timezone)}
                  {calendarConnected && !booking.google_event_id && (
                    <span
                      className="mr-2 rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-xs font-medium text-[var(--warn)] ring-1 ring-inset ring-[var(--warn)]/25"
                      title="הפגישה נשמרה אבל יצירת האירוע ביומן נכשלה — יש להוסיף אותו ידנית"
                    >
                      לא סונכרן ליומן
                    </span>
                  )}
                </td>
                <td className="td">
                  {eventType && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses(eventType.color)}`}
                    >
                      {eventType.name}
                    </span>
                  )}
                </td>
                <td className="td">
                  {booking.contact_id ? (
                    <Link href={`/contacts/${booking.contact_id}`} className="font-medium hover:underline">
                      {booking.invitee_name}
                    </Link>
                  ) : (
                    <span className="font-medium">{booking.invitee_name}</span>
                  )}
                  <span className="block text-xs text-[var(--subtle)]" dir="ltr">
                    {booking.invitee_email}
                    {booking.invitee_phone ? ` · ${booking.invitee_phone}` : ""}
                  </span>
                </td>
                <td className="td text-left">
                  <div className="flex items-center justify-end gap-1">
                    {booking.google_meet_url && (
                      <a
                        href={booking.google_meet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost"
                      >
                        Meet
                      </a>
                    )}
                    <ActionForm action={cancelBookingAction}>
                      <input type="hidden" name="id" value={booking.id} />
                      <button type="submit" className="btn-danger">
                        ביטול
                      </button>
                    </ActionForm>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
