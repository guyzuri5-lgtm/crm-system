import Image from "next/image";
import { notFound } from "next/navigation";
import { getActiveEventTypeBySlug, getBookingSettings } from "@/lib/booking/data";
import { accentStyle } from "@/lib/booking/accent";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import { GoogleMeetCard, GoogleMeetChip } from "@/components/google-meet-badge";
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

  const isMeet = eventType.location === "google_meet";
  const hasHostCard = Boolean(settings.host_photo_url || settings.host_name);

  return (
    // ארבעת משתני המבטא נקבעים כאן פעם אחת, ויורדים בירושה לכל הדף — כולל
    // BookingFlow, שהוא רכיב לקוח ולא מקבל את הצבע כ-prop. ראו accent.ts.
    <div className="card overflow-hidden p-0" style={accentStyle(eventType.color)}>
      {/* פס הכותרת, צבוע בגוון הרך של סוג הפגישה */}
      <div className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-7 py-6">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          {settings.host_photo_url && (
            <Image
              src={settings.host_photo_url}
              alt={settings.host_name ?? settings.brand_name}
              width={128}
              height={128}
              priority
              className="size-16 shrink-0 rounded-full object-cover shadow-sm ring-2 ring-white sm:size-20"
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--accent)]">
              {settings.host_name ?? settings.brand_name}
            </p>
            {settings.host_title && (
              <p className="mt-0.5 text-xs text-[var(--muted)]">{settings.host_title}</p>
            )}

            <h1 className={`text-2xl font-bold ${hasHostCard ? "mt-3" : "mt-1"}`}>
              {eventType.name}
            </h1>
            {eventType.description && (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
                {eventType.description}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)] ring-1 ring-inset ring-[var(--accent-muted)]">
                <ClockIcon />
                {eventType.duration_minutes} דקות
              </span>
              {isMeet ? (
                <GoogleMeetChip />
              ) : (
                <span className="flex items-center gap-1.5">
                  <PinIcon />
                  {eventType.location_details ?? BOOKING_LOCATION_LABELS[eventType.location]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ההסבר המלא, ולא רק התגית: "איפה הפגישה" הוא הדבר שהכי מרבים לשאול
            עליו אחרי קביעה, והמקום להגיד אותו הוא לפני הקביעה. */}
        {isMeet && (
          <div className="mt-5">
            <GoogleMeetCard />
          </div>
        )}
      </div>

      <BookingFlow
        slug={eventType.slug}
        durationMinutes={eventType.duration_minutes}
        maxDaysAhead={eventType.max_days_ahead}
        hostTimeZone={settings.timezone}
        isGoogleMeet={isMeet}
      />
    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-3.5">
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
