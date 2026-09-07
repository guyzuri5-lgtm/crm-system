import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/booking/timezone";
import { MetricTile, type MetricTileProps } from "@/components/metric-tile";
import { SkelMetricRow } from "@/components/skeleton";
import { Users, Calendar, Route, Ticket, Chat } from "./parts";
import {
  bounds,
  dailyCounts,
  relativeTime,
  todayBookings,
  channelHealth,
  nextEventWithPaid,
  journeyCounts,
  dayZone,
  TREND_ROW_CAP,
} from "./data";

/** ארבעת כרטיסי המדד בראש דף הבית. */
export async function Metrics() {
  const db = supabaseAdmin();
  const { now, startOfToday, endOfWeek, startOfMonth, sevenDaysAgo, trendFrom } = bounds();

  const [
    { count: activeCount },
    { count: newContactsCount },
    { count: weekBookingsCount },
    { count: sentThisMonthCount },
    { data: contactTrendRaw },
    { data: sentTrendRaw },
    bookings,
    journeys,
    upcoming,
    channel,
    zone,
  ] = await Promise.all([
    // אותו קריטריון בדיוק כמו /active: מי שיזם משהו, ולא כל מי שיובא מאקסל.
    db
      .from("contact_activity")
      .select("contact_id", { count: "exact", head: true })
      .not("last_customer_at", "is", null),
    db.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
    db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("status", "confirmed")
      .gte("starts_at", startOfToday.toISOString())
      .lt("starts_at", endOfWeek.toISOString()),
    // ב-interactions הכיוון מקודד בסוג הרשומה, ואלה שני הסוגים היוצאים.
    db
      .from("interactions")
      .select("id", { count: "exact", head: true })
      .in("type", ["whatsapp_out", "email_out"])
      .gte("created_at", startOfMonth.toISOString()),
    // ── שתי סדרות המגמה ──
    db
      .from("contacts")
      .select("created_at")
      .gte("created_at", trendFrom)
      .order("created_at", { ascending: false })
      .limit(TREND_ROW_CAP),
    db
      .from("interactions")
      .select("created_at")
      .in("type", ["whatsapp_out", "email_out"])
      .gte("created_at", trendFrom)
      .order("created_at", { ascending: false })
      .limit(TREND_ROW_CAP),
    todayBookings(),
    journeyCounts(),
    nextEventWithPaid(),
    channelHealth(),
    dayZone(),
  ]);

  const newContacts = newContactsCount ?? 0;

  const metrics: MetricTileProps[] = [
    {
      href: "/active",
      label: "לקוחות פעילים",
      value: String(activeCount ?? 0),
      context: (
        <>
          {newContacts > 0 && <b className="font-semibold text-[var(--ok)]">+{newContacts} </b>}
          {newContacts === 0 && <b className="font-semibold text-[var(--foreground)]">0 </b>}
          אנשי קשר חדשים בשבוע האחרון
        </>
      ),
      icon: <Users />,
      color: "var(--primary)",
      soft: "var(--primary-soft)",
      trend: dailyCounts(contactTrendRaw, now),
    },
    {
      href: "/booking/upcoming",
      label: "פגישות השבוע",
      value: String(weekBookingsCount ?? 0),
      context: bookings.length ? (
        <>
          <b className="font-semibold text-[var(--foreground)]">{bookings.length}</b> מהן היום
        </>
      ) : (
        "אין פגישות היום"
      ),
      icon: <Calendar />,
      color: "var(--nav-pink)",
      soft: "var(--nav-pink-soft)",
      // הפס מודד את היום מתוך השבוע, ולכן הוא נעלם כשאין שבוע למדוד מולו.
      bar: weekBookingsCount ? { value: bookings.length, max: weekBookingsCount } : undefined,
    },
    {
      href: "/journeys",
      label: "הודעות שיצאו החודש",
      value: String(sentThisMonthCount ?? 0),
      context: (
        <>
          <b className="font-semibold text-[var(--foreground)]">{journeys.active}</b> מסעות פעילים ·{" "}
          <b className="font-semibold text-[var(--foreground)]">{journeys.enrolled}</b> אנשים בתוכם
        </>
      ),
      icon: <Route />,
      color: "var(--nav-purple)",
      soft: "var(--nav-purple-soft)",
      trend: dailyCounts(sentTrendRaw, now),
    },
    // הכרטיס הרביעי מתחלף לפי מה שדחוף: כשיש אירוע קרוב הוא המספר שבעל
    // העסק בודק כמה פעמים ביום. כשאין — חוזר מצב הוואטסאפ, שהוא ברירת
    // המחדל הנכונה כי הוא מה שיישבר בשקט אם יישבר.
    upcoming
      ? {
          href: `/events/${upcoming.event.id}`,
          label: upcoming.event.name,
          value: String(upcoming.paid),
          suffix: upcoming.event.capacity ? ` / ${upcoming.event.capacity}` : undefined,
          context: `שילמו · ${formatDateTime(new Date(upcoming.event.starts_at), zone)}`,
          icon: <Ticket />,
          color: "var(--nav-amber)",
          soft: "var(--nav-amber-soft)",
          bar: upcoming.event.capacity
            ? { value: upcoming.paid, max: upcoming.event.capacity }
            : undefined,
        }
      : {
          href: "/whatsapp",
          label: "מצב הערוץ",
          value: channel.health.text,
          context: `שליחה אחרונה: ${relativeTime(channel.lastSentAt, now)}`,
          icon: <Chat />,
          color: channel.color,
          soft: channel.soft,
        },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <MetricTile key={metric.href} {...metric} />
      ))}
    </section>
  );
}

export function MetricsFallback() {
  return <SkelMetricRow count={4} />;
}
