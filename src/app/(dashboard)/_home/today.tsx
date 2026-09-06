import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listEventTypes } from "@/lib/booking/data";
import { utcToZonedParts, formatTime, formatDateTime, zonedDateKey } from "@/lib/booking/timezone";
import { countAudience } from "@/lib/newsletter";
import { statusToken } from "@/lib/status-colors";
import { DayTimeline, type DayItem } from "@/components/day-timeline";
import { SkelLine } from "@/components/skeleton";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import { Clock, glyphStyle, pillStyle } from "./parts";
import { bounds, todayBookings, dayZone, bookedRecently, TIMEZONE } from "./data";

/** ציר היום: פגישות מאושרות, והניוזלטר כשהוא יוצא היום. */
export async function Today() {
  const { now } = bounds();

  const [bookings, eventTypes, zone, { data: nextNewsletter }] = await Promise.all([
    todayBookings(),
    listEventTypes(),
    dayZone(),
    // הניוזלטר הקרוב. שגיאה כאן (מיגרציה 0022 שטרם רצה) לא מפילה את דף
    // הבית — השורה פשוט לא תוצג.
    supabaseAdmin()
      .from("newsletters")
      .select("id, subject, scheduled_at, audience")
      .in("status", ["scheduled", "sending"])
      .order("scheduled_at")
      .limit(1)
      .maybeSingle(),
  ]);

  // כמה אנשים יקבלו את הניוזלטר הקרוב. הקהל נשמר כתנאי ולא כרשימה, ולכן
  // הוא נספר עכשיו. נפילה כאן מסתירה את המספר בלבד.
  const newsletterAudience = nextNewsletter?.audience
    ? await countAudience(nextNewsletter.audience).catch(() => null)
    : null;

  const eventTypeById = new Map(eventTypes.map((type) => [type.id, type]));

  // שעון אחד לכל הציר: אותו אזור זמן שהשעות מוצגות בו הוא זה שקו "עכשיו"
  // ממוקם לפיו. שני אזורים שונים היו מזיזים את הקו בשעה בלי שיהיה סימן לכך.
  const dayItems: DayItem[] = bookings.map((booking) => {
    const eventType = eventTypeById.get(booking.event_type_id);
    const at = new Date(booking.starts_at);
    const detail = [
      eventType ? eventType.location_details || BOOKING_LOCATION_LABELS[eventType.location] : null,
      eventType ? `${eventType.duration_minutes} דק׳` : null,
      bookedRecently(booking.created_at, now),
    ].filter(Boolean);
    return {
      key: booking.id,
      minutes: utcToZonedParts(at, zone).minutes,
      time: formatTime(at, zone),
      title: [eventType?.name, booking.invitee_name].filter(Boolean).join(" · "),
      detail: detail.join(" · "),
      color: statusToken(eventType?.color),
      href: booking.contact_id ? `/contacts/${booking.contact_id}` : undefined,
    };
  });

  // הניוזלטר יושב על אותו ציר כשהוא יוצא היום. כשהוא מתוזמן ליום אחר הוא
  // יורד לשורה נפרדת מתחת לציר — אחרת הוא היה נעלם מדף הבית לגמרי.
  const newsletterAt = nextNewsletter?.scheduled_at ? new Date(nextNewsletter.scheduled_at) : null;
  const newsletterToday =
    newsletterAt && zonedDateKey(newsletterAt, TIMEZONE) === zonedDateKey(now, TIMEZONE);
  if (nextNewsletter && newsletterAt && newsletterToday) {
    dayItems.push({
      key: `newsletter-${nextNewsletter.id}`,
      minutes: utcToZonedParts(newsletterAt, zone).minutes,
      time: formatTime(newsletterAt, zone),
      title: `ניוזלטר: ${nextNewsletter.subject}`,
      detail: [newsletterAudience !== null ? `יוצא ל-${newsletterAudience} נמענים` : null, "מתוזמן"]
        .filter(Boolean)
        .join(" · "),
      color: "var(--nav-coral)",
      href: "/newsletter/scheduled",
    });
  }

  return (
    <section className="card flex flex-col p-0">
      <div className="card-h">
        <span className="glyph" style={glyphStyle("var(--nav-pink)", "var(--nav-pink-soft)")}>
          <Clock />
        </span>
        <h2>היום</h2>
        <span className="flex-1" />
        {bookings.length > 0 && (
          <span className="pill" style={pillStyle("var(--nav-pink)", "var(--nav-pink-soft)")}>
            {bookings.length} פגישות
          </span>
        )}
      </div>
      <div className="card-b">
        {dayItems.length ? (
          <DayTimeline
            items={dayItems}
            nowMinutes={utcToZonedParts(now, zone).minutes}
            nowLabel={formatTime(now, zone)}
          />
        ) : (
          <p className="py-2 text-sm text-[var(--muted)]">אין פגישות היום.</p>
        )}
      </div>
      {nextNewsletter && newsletterAt && !newsletterToday && (
        <div className="card-f">
          <Link href="/newsletter/scheduled" className="hover:underline">
            <span className="font-semibold">הניוזלטר הקרוב:</span> {nextNewsletter.subject} ·{" "}
            {formatDateTime(newsletterAt, zone)}
          </Link>
        </div>
      )}
    </section>
  );
}

export function TodayFallback() {
  return (
    <section className="card flex flex-col p-0">
      <div className="card-h">
        <span className="glyph" style={glyphStyle("var(--nav-pink)", "var(--nav-pink-soft)")}>
          <Clock />
        </span>
        <h2>היום</h2>
      </div>
      <div className="card-b flex flex-col gap-3.5 py-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <SkelLine w="42px" h={11} />
            <SkelLine w={`${70 - i * 9}%`} h={13} />
          </div>
        ))}
      </div>
    </section>
  );
}
