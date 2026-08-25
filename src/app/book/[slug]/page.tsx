import { notFound } from "next/navigation";
import { getActiveEventTypeBySlug, getBookingSettings } from "@/lib/booking/data";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import { BookingFlow } from "./booking-flow";

// דף ההזמנה הציבורי. רץ בלי משתמש מחובר — ראו PUBLIC_PATHS ב-src/proxy.ts.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  const eventType = await getActiveEventTypeBySlug(slug);
  if (!eventType) return { title: "הקישור לא נמצא" };
  return {
    title: `${eventType.name} — קביעת פגישה`,
    description: eventType.description ?? undefined,
    // דף הזמנה אישי לא אמור להופיע בתוצאות חיפוש.
    robots: { index: false, follow: false },
  };
}

export default async function BookPage({ params }: PageProps<"/book/[slug]">) {
  const { slug } = await params;
  const [eventType, settings] = await Promise.all([
    getActiveEventTypeBySlug(slug),
    getBookingSettings(),
  ]);

  if (!eventType) notFound();

  return (
    <div className="card p-0 overflow-hidden">
      <div className="border-b border-[var(--border)] px-7 py-6">
        <p className="text-sm text-[var(--muted)]">{settings.brand_name}</p>
        <h1 className="mt-1 text-2xl font-bold">{eventType.name}</h1>
        {eventType.description && (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            {eventType.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--muted)]">
          <span className="flex items-center gap-1.5">
            <ClockIcon />
            {eventType.duration_minutes} דקות
          </span>
          <span className="flex items-center gap-1.5">
            <PinIcon />
            {eventType.location === "google_meet"
              ? BOOKING_LOCATION_LABELS.google_meet
              : (eventType.location_details ?? BOOKING_LOCATION_LABELS[eventType.location])}
          </span>
        </div>
      </div>

      <BookingFlow
        slug={eventType.slug}
        durationMinutes={eventType.duration_minutes}
        maxDaysAhead={eventType.max_days_ahead}
        hostTimeZone={settings.timezone}
      />
    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
      <path
        d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
