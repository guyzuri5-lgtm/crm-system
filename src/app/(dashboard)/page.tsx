import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings, listEventTypes } from "@/lib/booking/data";
import {
  utcToZonedParts,
  zonedTimeToUtc,
  zonedDateKey,
  formatTime,
  formatDateTime,
} from "@/lib/booking/timezone";
import { getWhatsAppSettings } from "@/lib/whatsapp-throttle";
import { isWhatsAppConfigured, getPhoneNumberStatus } from "@/lib/whatsapp-cloud";
import { countAudience } from "@/lib/newsletter";
import { statusToken } from "@/lib/status-colors";
import { MetricTile, type MetricTileProps } from "@/components/metric-tile";
import { DayTimeline, type DayItem } from "@/components/day-timeline";
import { BOOKING_LOCATION_LABELS } from "@/lib/supabase/database.types";
import type { Contact } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/** אזור הזמן שלפיו נמדדים "היום", "השבוע" ו"החודש" — אותו אחד ששאר המערכת מניחה. */
const TIMEZONE = "Asia/Jerusalem";

/** כמה ימי שקט הופכים איש קשר ל"דורש טיפול". אותה יחידה שהכללים עובדים בה. */
const NO_REPLY_DAYS = 3;

/** מעבר לזה, "לא נשמע ממנו" מפסיק להיות תזכורת ומתחיל להיות התראה. */
const URGENT_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * אורך חלון גרפי המגמה. ארבעה-עשר יום ולא חודש: מספר השורות שנשלפות נשאר
 * חסום, והצורה בקצה — זה שהעין קוראת — נשארת מדויקת.
 */
const TREND_DAYS = 14;

/**
 * חסם על שתי שאילתות המגמה. הן שולפות שורות ולא ספירות, כי PostgREST לא
 * יודע לקבץ לפי יום בלי RPC — ומיגרציה חורגת מגבולות עבודת העיצוב. הסדר
 * יורד בכוונה: אם החסם ייגע אי-פעם, ייחתכו הימים הישנים ולא החדשים.
 */
const TREND_ROW_CAP = 3000;

function greeting(hourInIsrael: number): string {
  if (hourInIsrael < 12) return "בוקר טוב";
  if (hourInIsrael < 17) return "צהריים טובים";
  return "ערב טוב";
}

/** "יום רביעי" · "כ״ב באלול" · "2 בספטמבר 2026" — שלושה חלקים, לא מחרוזת אחת. */
function dateParts(now: Date): { weekday: string; hebrew: string; gregorian: string } {
  const weekday = new Intl.DateTimeFormat("he-IL", { timeZone: TIMEZONE, weekday: "long" }).format(now);
  // התאריך העברי מגיע מלוח השנה של ICU — אין כאן טבלת חגים לתחזק.
  const hebrew = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "long",
  }).format(now);
  const gregorian = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  return { weekday, hebrew, gregorian };
}

function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "עדיין לא נשלחה הודעה";
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

/** "נקבע היום" רק כשזה באמת חדש — פגישה שנקבעה לפני שבוע היא סתם פגישה. */
function bookedRecently(iso: string, now: Date): string | null {
  const days = daysSince(iso, now);
  if (days === 0) return "נקבע היום";
  if (days === 1) return "נקבע אתמול";
  return null;
}

/** שתי אותיות ראשונות משתי המילים הראשונות בשם, לאווטר. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => [...word][0]).join("");
}

/**
 * ספירה ליום לאורך TREND_DAYS הימים האחרונים, מהישן לחדש. הקיבוץ נעשה לפי
 * שעון ישראל ולא לפי UTC — אחרת הודעה שיצאה בעשר בערב נספרת למחרת.
 */
function dailyCounts(rows: { created_at: string }[] | null, now: Date): number[] {
  const buckets = new Map<string, number>();
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    buckets.set(zonedDateKey(new Date(now.getTime() - i * DAY_MS), TIMEZONE), 0);
  }
  for (const row of rows ?? []) {
    const key = zonedDateKey(new Date(row.created_at), TIMEZONE);
    const current = buckets.get(key);
    if (current !== undefined) buckets.set(key, current + 1);
  }
  return [...buckets.values()];
}

/** מצב הערוץ בשורה אחת. bad צובע את הכרטיס באדום, warn משאיר אותו בענבר. */
type Health = { text: string; tone: "ok" | "warn" | "bad" };

function whatsappHealth(
  configured: boolean,
  paused: boolean,
  statusError: string | null,
  qualityRating: string | null
): Health {
  if (!configured) return { text: "לא מוגדר", tone: "bad" };
  // מתג ההשהיה חוסם שליחה בשקט, ולכן הוא חייב להיראות דווקא כאן.
  if (paused) return { text: "מושהה", tone: "bad" };
  if (statusError) return { text: statusError, tone: "bad" };
  if (qualityRating === "RED") return { text: "איכות נמוכה", tone: "bad" };
  if (qualityRating === "YELLOW") return { text: "איכות יורדת", tone: "warn" };
  return { text: "תקין", tone: "ok" };
}

/* ── אייקונים ───────────────────────────────────────────────────────────── */
/* קו בעובי אחיד, 24×24. הגודל נקבע בכל אתר קריאה, כי אותו אייקון מופיע
   בריבוע של 24 פיקסלים בכרטיס מדד ובריבוע של 32 בשורת המצב. */

function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const Users = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

const Calendar = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2.5v4M8 2.5v4M3 10h18" />
  </Svg>
);

const Route = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="5" r="3" />
    <path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" />
  </Svg>
);

const Ticket = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2 9.5a3 3 0 0 1 0 6V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2.5a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
    <path d="M13 5.5v13" />
  </Svg>
);

const Clock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.2 2" />
  </Svg>
);

const Alert = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17.2h.01" />
  </Svg>
);

const Chat = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </Svg>
);

const School = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M22 10v6" />
    <path d="M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </Svg>
);

/** ריבוע אייקון צבעוני — שני אסימונים, בלי לחזור על שתי השורות בכל קריאה. */
function glyphStyle(color: string, soft: string): CSSProperties {
  return { "--glyph-color": color, "--glyph-bg": soft } as CSSProperties;
}

/** תווית רכה בגוון — אותו דבר לספירות שיושבות בכותרות ובשורות קבוצה. */
function pillStyle(color: string, soft: string): CSSProperties {
  return { "--pill-color": color, "--pill-bg": soft } as CSSProperties;
}

export default async function DashboardPage() {
  const { email } = await verifyTeamMember();

  const db = supabaseAdmin();
  const now = new Date();

  // כל הגבולות נחתכים לפי שעון ישראל ולא לפי UTC — אחרת "היום" מתחיל בשלוש
  // לפנות בוקר, ופגישה של תשע בערב נופלת למחר.
  const { year, month, day, weekday, minutes } = utcToZonedParts(now, TIMEZONE);
  const startOfToday = zonedTimeToUtc(year, month, day, 0, TIMEZONE);
  const endOfToday = zonedTimeToUtc(year, month, day + 1, 0, TIMEZONE);
  // סוף השבוע הישראלי: מוצאי שבת. weekday 0 = ראשון.
  const endOfWeek = zonedTimeToUtc(year, month, day + (6 - weekday) + 1, 0, TIMEZONE);
  const startOfMonth = zonedTimeToUtc(year, month, 1, 0, TIMEZONE);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const noReplyCutoff = new Date(now.getTime() - NO_REPLY_DAYS * DAY_MS).toISOString();
  const trendFrom = zonedTimeToUtc(year, month, day - (TREND_DAYS - 1), 0, TIMEZONE).toISOString();

  const configured = isWhatsAppConfigured();

  const [
    { count: activeCount },
    { count: newContactsCount },
    { count: weekBookingsCount },
    { count: sentThisMonthCount },
    { count: activeJourneysCount },
    { count: enrolledCount },
    { data: todayBookings },
    { data: quietContacts, count: quietTotal },
    { data: lastWhatsAppOut },
    { data: nextNewsletter },
    { data: nextEvent },
    { count: unpaidCount },
    { data: courseInterestedRaw },
    { count: newCourseInterestCount },
    { data: eventInterestedRaw },
    { data: enrolledRaw },
    { data: contactTrendRaw },
    { data: sentTrendRaw },
    eventTypes,
    bookingSettings,
    whatsappSettings,
    phoneStatus,
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
    db.from("journeys").select("id", { count: "exact", head: true }).eq("active", true),
    db
      .from("journey_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("state", "active"),
    db
      .from("bookings")
      .select("*")
      .eq("status", "confirmed")
      .gte("starts_at", startOfToday.toISOString())
      .lt("starts_at", endOfToday.toISOString())
      .order("starts_at"),
    // הקריטריון של הטריגר "זמן ללא מענה" (src/lib/automation-engine.ts), עם 3
    // ימים ובלי סינון סטטוס — כאן רק מציגים, לא שולחים. הסדר יורד כדי שמי
    // ששתק לאחרונה יופיע ראשון, ומי שמעולם לא כתב (null) ייפול לסוף.
    //
    // ה-count מגיע על אותה שאילתה ולא בנוספת: הכרטיס מציג חמישה שמות אבל
    // התווית בכותרת סופרת את כולם.
    db
      .from("contacts")
      .select("*", { count: "exact" })
      .or(
        `last_incoming_message_at.lte.${noReplyCutoff},and(last_incoming_message_at.is.null,created_at.lte.${noReplyCutoff})`
      )
      .order("last_incoming_message_at", { ascending: false, nullsFirst: false })
      .limit(5),
    db
      .from("interactions")
      .select("created_at")
      .eq("type", "whatsapp_out")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // הניוזלטר הקרוב. שגיאה כאן (מיגרציה 0022 שטרם רצה) לא מפילה את דף
    // הבית — השורה פשוט לא תוצג.
    db
      .from("newsletters")
      .select("id, subject, scheduled_at, audience")
      .in("status", ["scheduled", "sending"])
      .order("scheduled_at")
      .limit(1)
      .maybeSingle(),
    // האירוע הקרוב, ומי שנרשמה אליו ולא שילמה. כמו הניוזלטר: אם 0024 טרם
    // רצה השגיאה נבלעת, הנתון פשוט לא מוצג, ודף הבית ממשיך לעבוד.
    db
      .from("events")
      .select("id, name, starts_at, capacity")
      .eq("active", true)
      .gte("starts_at", now.toISOString())
      .order("starts_at")
      .limit(1)
      .maybeSingle(),
    db
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("stage", "registered")
      .lte("created_at", new Date(now.getTime() - DAY_MS).toISOString()),
    // ── קורסים (0028) ──
    // שלוש שאילתות רזות שמחזירות contact_id בלבד: הצטלבות "מי מתעניינת"
    // מול "מי כבר במסע" נעשית בזיכרון, כי PostgREST לא יודע NOT IN על
    // תת-שאילתה. אם 0028 טרם רצה, השגיאה נבלעת ו-null הופך לרשימה ריקה —
    // דף הבית ממשיך לעבוד בדיוק כמו קודם.
    db.from("course_registrations").select("contact_id").eq("stage", "interested"),
    db
      .from("course_registrations")
      .select("id", { count: "exact", head: true })
      .eq("stage", "interested")
      .gte("created_at", sevenDaysAgo),
    db.from("event_registrations").select("contact_id").eq("stage", "interested"),
    db.from("journey_enrollments").select("contact_id"),
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
    listEventTypes(),
    getBookingSettings(),
    getWhatsAppSettings(),
    // קריאת רשת ל-Meta: נכשלת בנפרד ולא מפילה את דף הבית.
    configured
      ? getPhoneNumberStatus().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : Promise.resolve(null),
  ]);

  const bookings = todayBookings ?? [];
  const quiet = (quietContacts ?? []) as Contact[];

  // גל שני: שלוש שאילתות שתלויות בתוצאות שלמעלה, ולכן לא יכלו לרוץ איתן.
  // יחד ולא בזו אחר זו — הן אינן תלויות זו בזו.
  const [{ count: nextEventPaid }, { data: quietActivity }, newsletterAudience] = await Promise.all([
    nextEvent
      ? db
          .from("event_registrations")
          .select("id", { count: "exact", head: true })
          .eq("event_id", nextEvent.id)
          .eq("stage", "paid")
      : Promise.resolve({ count: null }),
    // מה שכל אחת מהן כתבה לאחרונה. התצוגה כבר מחזיקה את הטקסט, ולכן זו
    // שליפה אחת לפי מזהים ולא שאילתה לכל שורה.
    quiet.length
      ? db
          .from("contact_activity")
          .select("contact_id, last_inbound_text")
          .in(
            "contact_id",
            quiet.map((contact) => contact.id)
          )
      : Promise.resolve({ data: [] }),
    // כמה אנשים יקבלו את הניוזלטר הקרוב. הקהל נשמר כתנאי ולא כרשימה, ולכן
    // הוא נספר עכשיו. נפילה כאן מסתירה את המספר בלבד.
    nextNewsletter?.audience
      ? countAudience(nextNewsletter.audience).catch(() => null)
      : Promise.resolve(null),
  ]);

  const statusError = phoneStatus && "error" in phoneStatus ? phoneStatus.error : null;
  const phone = phoneStatus && !("error" in phoneStatus) ? phoneStatus : null;
  const health = whatsappHealth(
    configured,
    whatsappSettings.paused,
    statusError,
    phone?.qualityRating ?? null
  );
  const healthColor = health.tone === "bad" ? "var(--danger)" : health.tone === "warn" ? "var(--warn)" : "var(--ok)";
  const healthSoft = health.tone === "bad" ? "var(--danger-soft)" : health.tone === "warn" ? "var(--warn-soft)" : "var(--ok-soft)";

  const eventTypeById = new Map(eventTypes.map((type) => [type.id, type]));
  const lastTextById = new Map(
    (quietActivity ?? []).map((row) => [row.contact_id as string, row.last_inbound_text as string | null])
  );

  // ── מתעניינות ──
  const courseInterested = (courseInterestedRaw ?? []).map((r) => r.contact_id);
  const courseInterestedCount = new Set(courseInterested).size;

  // מי שהשאירה פרטים ואף אחד לא בנה לה המשך. זו הרשימה שהמסעות נועדו לה,
  // ולכן "מתעניינת שאינה באף מסע" היא הפער האמיתי — לא מספר המתעניינות.
  const enrolledIds = new Set((enrolledRaw ?? []).map((r) => r.contact_id));
  const interestedIds = new Set([
    ...courseInterested,
    ...(eventInterestedRaw ?? []).map((r) => r.contact_id),
  ]);
  const unlinkedInterestedCount = [...interestedIds].filter((id) => !enrolledIds.has(id)).length;

  const attentionTotal = (quietTotal ?? 0) + (unpaidCount ?? 0) + unlinkedInterestedCount;

  // ── ציר היום ──
  // שעון אחד לכל הציר: אותו אזור זמן שהשעות מוצגות בו הוא זה שקו "עכשיו"
  // ממוקם לפיו. שני אזורים שונים היו מזיזים את הקו בשעה בלי שיהיה סימן לכך.
  const dayZone = bookingSettings.timezone;
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
      minutes: utcToZonedParts(at, dayZone).minutes,
      time: formatTime(at, dayZone),
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
      minutes: utcToZonedParts(newsletterAt, dayZone).minutes,
      time: formatTime(newsletterAt, dayZone),
      title: `ניוזלטר: ${nextNewsletter.subject}`,
      detail: [
        newsletterAudience !== null ? `יוצא ל-${newsletterAudience} נמענים` : null,
        "מתוזמן",
      ]
        .filter(Boolean)
        .join(" · "),
      color: "var(--nav-coral)",
      href: "/newsletter/scheduled",
    });
  }

  const { weekday: weekdayName, hebrew, gregorian } = dateParts(now);
  const newContacts = newContactsCount ?? 0;

  const metrics: MetricTileProps[] = [
    {
      href: "/active",
      label: "לקוחות פעילים",
      value: String(activeCount ?? 0),
      context: (
        <>
          {newContacts > 0 && (
            <b className="font-semibold text-[var(--ok)]">+{newContacts} </b>
          )}
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
          <b className="font-semibold text-[var(--foreground)]">{activeJourneysCount ?? 0}</b> מסעות
          פעילים · <b className="font-semibold text-[var(--foreground)]">{enrolledCount ?? 0}</b>{" "}
          אנשים בתוכם
        </>
      ),
      icon: <Route />,
      color: "var(--nav-purple)",
      soft: "var(--nav-purple-soft)",
      trend: dailyCounts(sentTrendRaw, now),
    },
    // הכרטיס הרביעי מתחלף לפי מה שדחוף: כשיש אירוע קרוב הוא המספר שבעלת
    // העסק בודקת כמה פעמים ביום. כשאין — חוזר מצב הוואטסאפ, שהוא ברירת
    // המחדל הנכונה כי הוא מה שיישבר בשקט אם יישבר.
    nextEvent
      ? {
          href: `/events/${nextEvent.id}`,
          label: nextEvent.name,
          value: String(nextEventPaid ?? 0),
          suffix: nextEvent.capacity ? ` / ${nextEvent.capacity}` : undefined,
          context: `שילמו · ${formatDateTime(new Date(nextEvent.starts_at), dayZone)}`,
          icon: <Ticket />,
          color: "var(--nav-amber)",
          soft: "var(--nav-amber-soft)",
          bar: nextEvent.capacity
            ? { value: nextEventPaid ?? 0, max: nextEvent.capacity }
            : undefined,
        }
      : {
          href: "/whatsapp",
          label: "מצב הערוץ",
          value: health.text,
          context: `שליחה אחרונה: ${relativeTime(lastWhatsAppOut?.created_at ?? null, now)}`,
          icon: <Chat />,
          color: healthColor,
          soft: healthSoft,
        },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="text-[26px] font-medium tracking-[-0.025em] [font-family:var(--font-display)]">
          {greeting(Math.floor(minutes / 60))}
          {email ? `, ${email.split("@")[0]}` : ""}
        </h1>
        <p className="text-[12.5px] text-[var(--subtle)]">
          <b className="font-medium text-[var(--muted)]">{weekdayName}</b> · {hebrew} · {gregorian}
        </p>
      </div>

      {/* ── ארבעה מדדים ─────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <MetricTile key={metric.href} {...metric} />
        ))}
      </section>

      {/* ── היום · דורש טיפול ───────────────────────────────────────── */}
      {/* היום רחב יותר: ציר זמן צריך מקום לשמות מלאים, ורשימת המשימות לא. */}
      <section className="grid gap-3.5 lg:grid-cols-[1.15fr_0.85fr]">
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
                nowMinutes={utcToZonedParts(now, dayZone).minutes}
                nowLabel={formatTime(now, dayZone)}
              />
            ) : (
              <p className="py-2 text-sm text-[var(--muted)]">אין פגישות היום.</p>
            )}
          </div>
          {nextNewsletter && newsletterAt && !newsletterToday && (
            <div className="card-f">
              <Link href="/newsletter/scheduled" className="hover:underline">
                <span className="font-semibold">הניוזלטר הקרוב:</span> {nextNewsletter.subject} ·{" "}
                {formatDateTime(newsletterAt, dayZone)}
              </Link>
            </div>
          )}
        </section>

        <section className="card flex flex-col p-0">
          <div className="card-h">
            <span className="glyph" style={glyphStyle("var(--nav-coral)", "var(--nav-coral-soft)")}>
              <Alert />
            </span>
            <h2>דורש טיפול</h2>
            <span className="flex-1" />
            {attentionTotal > 0 && (
              <span className="pill" style={pillStyle("var(--nav-coral)", "var(--nav-coral-soft)")}>
                {attentionTotal}
              </span>
            )}
          </div>

          <div className="card-b">
            {attentionTotal === 0 ? (
              <p className="py-2 text-sm text-[var(--muted)]">הכול מטופל ✔</p>
            ) : (
              <>
                {quiet.map((contact) => {
                  const name = contact.full_name || contact.phone || "ללא שם";
                  const said = lastTextById.get(contact.id);
                  const days = daysSince(
                    contact.last_incoming_message_at ?? contact.created_at,
                    now
                  );
                  const urgent = days >= URGENT_DAYS;
                  return (
                    <div
                      key={contact.id}
                      className="flex items-center gap-2.5 border-b border-[var(--border)] py-2.5 last:border-b-0"
                    >
                      <span className="av" aria-hidden="true">
                        {initials(name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="block truncate text-[13px] font-medium hover:underline"
                        >
                          {name}
                        </Link>
                        {said && (
                          <span className="block truncate text-[11px] text-[var(--muted)]">
                            {said}
                          </span>
                        )}
                      </span>
                      <span
                        className="pill"
                        style={
                          urgent
                            ? pillStyle("var(--nav-coral)", "var(--nav-coral-soft)")
                            : pillStyle("var(--nav-amber)", "var(--nav-amber-soft)")
                        }
                      >
                        {days} ימים
                      </span>
                    </div>
                  );
                })}

                {(Boolean(unpaidCount) || unlinkedInterestedCount > 0) && (
                  <div className={`flex flex-col gap-2 ${quiet.length ? "mt-3" : ""}`}>
                    {/* מי שהשאירה פרטים, יצאה לתשלום ולא חזרה. יממה היא הסף
                        שבו זה מפסיק להיות "היא עוד באמצע" ומתחיל להיות
                        "צריך לפנות אליה". */}
                    {Boolean(unpaidCount) && (
                      <Link href="/events" className="group-row">
                        <span
                          className="glyph size-6"
                          style={glyphStyle("var(--nav-pink)", "var(--nav-pink-soft)")}
                        >
                          <Ticket size={13} />
                        </span>
                        <b className="font-semibold">נרשמו לאירוע ולא שילמו</b>
                        <span className="flex-1" />
                        <span
                          className="pill"
                          style={pillStyle("var(--nav-pink)", "var(--nav-pink-soft)")}
                        >
                          {unpaidCount}
                        </span>
                      </Link>
                    )}

                    {/* מתעניינת שאינה באף מסע היא ליד שנפל בין הכיסאות: היא
                        השאירה פרטים, ואיש לא בנה לה המשך. הקישור מוביל
                        למסעות, כי זו הפעולה שסוגרת את הפער. */}
                    {unlinkedInterestedCount > 0 && (
                      <Link href="/journeys" className="group-row">
                        <span
                          className="glyph size-6"
                          style={glyphStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
                        >
                          <Route size={13} />
                        </span>
                        <b className="font-semibold">מתעניינות שאינן באף מסע</b>
                        <span className="flex-1" />
                        <span
                          className="pill"
                          style={pillStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
                        >
                          {unlinkedInterestedCount}
                        </span>
                      </Link>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="card-f mt-auto">
            מי שלא נשמע ממנו {NO_REPLY_DAYS} ימים ומעלה נכנס לרשימה אוטומטית.
          </div>
        </section>
      </section>

      {/* ── שורת מצב ────────────────────────────────────────────────── */}
      {/*
        המתזמן היה אמור לשבת כאן, אבל אין טבלה שרושמת את ריצות הקרון — ואין
        ממה לגזור "רץ לאחרונה ב-". במקומו נכנס כאן הכרטיס של הקורסים (0028).
      */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/whatsapp" className="card flex items-center gap-3 px-4 py-3.5">
          <span className="glyph size-8" style={glyphStyle(healthColor, healthSoft)}>
            <Chat size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold break-words">{health.text}</span>
            <span className="block text-[11.5px] text-[var(--muted)]">
              ערוץ הוואטסאפ
              {phone?.displayPhoneNumber && (
                <>
                  {" · "}
                  {/* בלי dir המספר נשבר: הדפדפן מסדר את הקטעים שלו מימין לשמאל. */}
                  <span className="data" dir="ltr">
                    {phone.displayPhoneNumber}
                  </span>
                </>
              )}
            </span>
          </span>
          {/* רק כשהאיכות ירוקה: בכל מצב אחר הכותרת כבר אומרת את זה, והתווית
              הייתה חוזרת על עצמה. */}
          {health.tone === "ok" && phone?.qualityRating === "GREEN" && (
            <span className="pill" style={pillStyle("var(--ok)", "var(--ok-soft)")}>
              איכות ירוקה
            </span>
          )}
        </Link>

        <Link href="/journeys" className="card flex items-center gap-3 px-4 py-3.5">
          <span
            className="glyph size-8"
            style={glyphStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
          >
            <Route size={15} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold">
              {enrolledCount ?? 0} אנשים במסעות כרגע
            </span>
            <span className="block text-[11.5px] text-[var(--muted)]">
              {activeJourneysCount ?? 0} מסעות פעילים
            </span>
          </span>
        </Link>

        <Link href="/courses" className="card flex items-center gap-3 px-4 py-3.5">
          <span
            className="glyph size-8"
            style={glyphStyle("var(--nav-blue)", "var(--nav-blue-soft)")}
          >
            <School size={15} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold">
              {courseInterestedCount} מתעניינות בקורסים
            </span>
            <span className="block text-[11.5px] text-[var(--muted)]">
              {newCourseInterestCount ?? 0} חדשות השבוע
            </span>
          </span>
        </Link>
      </section>
    </div>
  );
}
