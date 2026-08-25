import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings } from "@/lib/booking/data";
import { formatDateTime, hasPassed } from "@/lib/booking/timezone";
import type { BookingEventType } from "@/lib/supabase/database.types";
import { cancelByToken } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ביטול פגישה",
  robots: { index: false, follow: false },
};

export default async function CancelBookingPage({ params }: PageProps<"/book/cancel/[token]">) {
  const { token } = await params;

  const { data: booking } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("cancel_token", token)
    .maybeSingle();

  if (!booking) notFound();

  const [settings, eventTypeResult] = await Promise.all([
    getBookingSettings(),
    supabaseAdmin()
      .from("booking_event_types")
      .select("*")
      .eq("id", booking.event_type_id)
      .maybeSingle(),
  ]);

  const eventType = eventTypeResult.data as BookingEventType | null;
  const start = new Date(booking.starts_at);
  const alreadyCancelled = booking.status === "cancelled";
  const alreadyPassed = hasPassed(start);

  return (
    <div className="card text-center">
      <p className="text-sm text-[var(--muted)]">{settings.brand_name}</p>

      {alreadyCancelled ? (
        <>
          <h1 className="mt-1 text-xl font-bold">הפגישה בוטלה</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {eventType?.name} · {formatDateTime(start, settings.timezone)}
          </p>
          {eventType && (
            <Link href={`/book/${eventType.slug}`} className="btn-primary mt-6">
              קביעת מועד חדש
            </Link>
          )}
        </>
      ) : alreadyPassed ? (
        <>
          <h1 className="mt-1 text-xl font-bold">הפגישה כבר התקיימה</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {eventType?.name} · {formatDateTime(start, settings.timezone)}
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-1 text-xl font-bold">לבטל את הפגישה?</h1>
          <div className="mt-4 rounded-xl bg-[var(--background)] px-4 py-3 text-sm">
            <p className="font-semibold">{eventType?.name}</p>
            <p className="mt-1 text-[var(--muted)]">{formatDateTime(start, settings.timezone)}</p>
          </div>

          <form action={cancelByToken} className="mt-5 flex flex-wrap justify-center gap-2">
            <input type="hidden" name="token" value={token} />
            <button type="submit" className="btn-secondary">
              כן, לבטל את הפגישה
            </button>
            {eventType && (
              <Link href={`/book/${eventType.slug}`} className="btn-ghost">
                השארת הפגישה
              </Link>
            )}
          </form>
        </>
      )}
    </div>
  );
}
