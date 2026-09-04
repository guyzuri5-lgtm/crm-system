import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings, listEventTypes } from "@/lib/booking/data";
import { utcToZonedParts, zonedTimeToUtc, formatTime, formatDateTime } from "@/lib/booking/timezone";
import { getWhatsAppSettings } from "@/lib/whatsapp-throttle";
import { isWhatsAppConfigured, getPhoneNumberStatus } from "@/lib/whatsapp-cloud";
import { statusColorClasses } from "@/lib/status-colors";
import type { Contact } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/** אזור הזמן שלפיו נמדדים "היום", "השבוע" ו"החודש" — אותו אחד ששאר המערכת מניחה. */
const TIMEZONE = "Asia/Jerusalem";

/** כמה ימי שקט הופכים איש קשר ל"דורש טיפול". אותה יחידה שהכללים עובדים בה. */
const NO_REPLY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function greeting(hourInIsrael: number): string {
  if (hourInIsrael < 12) return "בוקר טוב";
  if (hourInIsrael < 17) return "צהריים טובים";
  return "ערב טוב";
}

/** "יום רביעי · 20 באלול · 2 בספטמבר 2026" */
function dateLine(now: Date): string {
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
  return `${weekday} · ${hebrew} · ${gregorian}`;
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

function Bolt() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
    </svg>
  );
}

function School() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 10v6" />
      <path d="M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function Route() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" />
    </svg>
  );
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

  const configured = isWhatsAppConfigured();

  const [
    { count: activeCount },
    { count: newContactsCount },
    { count: weekBookingsCount },
    { count: sentThisMonthCount },
    { count: activeJourneysCount },
    { count: enrolledCount },
    { data: todayBookings },
    { data: quietContacts },
    { data: lastWhatsAppOut },
    { data: nextNewsletter },
    { data: nextEvent },
    { count: unpaidCount },
    { data: courseInterestedRaw },
    { count: newCourseInterestCount },
    { data: eventInterestedRaw },
    { data: enrolledRaw },
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
    db
      .from("contacts")
      .select("*")
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
      .select("id, subject, scheduled_at")
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

  const statusError = phoneStatus && "error" in phoneStatus ? phoneStatus.error : null;
  const phone = phoneStatus && !("error" in phoneStatus) ? phoneStatus : null;
  const health = whatsappHealth(
    configured,
    whatsappSettings.paused,
    statusError,
    phone?.qualityRating ?? null
  );

  const eventTypeById = new Map(eventTypes.map((type) => [type.id, type]));
  const bookings = todayBookings ?? [];
  const quiet = (quietContacts ?? []) as Contact[];

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

  // כמה כבר שילמו לאירוע הקרוב. שאילתה נפרדת ולא חלק מה-Promise.all שלמעלה,
  // כי היא תלויה במזהה שיוצא ממנו.
  const { count: nextEventPaid } = nextEvent
    ? await db
        .from("event_registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_id", nextEvent.id)
        .eq("stage", "paid")
    : { count: null };

  const metrics: {
    href: string;
    label: string;
    value: string;
    context: string;
    soft: string;
    strong: string;
    /** פס התקדמות דקיק — רק לכרטיס האירוע, וגם שם רק כשיש קיבולת. */
    progress?: { value: number; max: number };
  }[] = [
    {
      href: "/active",
      label: "לקוחות פעילים",
      value: String(activeCount ?? 0),
      context: `${newContactsCount ?? 0} אנשי קשר חדשים בשבוע האחרון`,
      soft: "var(--primary-soft)",
      strong: "var(--primary)",
    },
    {
      href: "/booking/upcoming",
      label: "פגישות השבוע",
      value: String(weekBookingsCount ?? 0),
      context: bookings.length ? `${bookings.length} היום` : "אין פגישות היום",
      soft: "var(--nav-pink-soft)",
      strong: "var(--nav-pink)",
    },
    {
      href: "/journeys",
      label: "הודעות שנשלחו החודש",
      value: String(sentThisMonthCount ?? 0),
      context: `${activeJourneysCount ?? 0} מסעות פעילים`,
      soft: "var(--nav-purple-soft)",
      strong: "var(--nav-purple)",
    },
    // הכרטיס הרביעי מתחלף לפי מה שדחוף: כשיש אירוע קרוב הוא המספר שבעלת
    // העסק בודקת כמה פעמים ביום. כשאין — חוזר מצב הוואטסאפ, שהוא ברירת
    // המחדל הנכונה כי הוא מה שיישבר בשקט אם יישבר.
    nextEvent
      ? {
          href: `/events/${nextEvent.id}`,
          label: nextEvent.name,
          value: nextEvent.capacity
            ? `${nextEventPaid ?? 0}/${nextEvent.capacity}`
            : String(nextEventPaid ?? 0),
          context: `נרשמו · ${formatDateTime(new Date(nextEvent.starts_at), TIMEZONE)}`,
          soft: "var(--nav-amber-soft)",
          strong: "var(--nav-amber)",
          progress: nextEvent.capacity
            ? { value: nextEventPaid ?? 0, max: nextEvent.capacity }
            : undefined,
        }
      : {
          href: "/whatsapp",
          label: "מצב וואטסאפ",
          value: health.text,
          context: `שליחה אחרונה: ${relativeTime(lastWhatsAppOut?.created_at ?? null, now)}`,
          soft: health.tone === "bad" ? "var(--danger-soft)" : "var(--nav-amber-soft)",
          strong: health.tone === "bad" ? "var(--danger)" : "var(--nav-amber)",
        },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold">
          {greeting(Math.floor(minutes / 60))}
          {email ? `, ${email.split("@")[0]}` : ""}
        </h1>
        <p className="text-sm text-[var(--subtle)]">{dateLine(now)}</p>
      </div>

      {/* ── ארבעה מדדים ─────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Link
            key={metric.href}
            href={metric.href}
            className="rounded-2xl p-5 transition-transform duration-150 ease-out active:scale-[0.99]"
            style={{ backgroundColor: metric.soft }}
          >
            {/*
              break-words ולא truncate: הכרטיס של הוואטסאפ מציג שגיאה מלאה
              כשמשהו נשבר, ושגיאה חתוכה באמצע לא שווה כלום.
            */}
            <p
              className="text-2xl font-medium break-words"
              style={{ color: metric.strong }}
            >
              {metric.value}
            </p>
            <p className="mt-1 text-sm font-medium" style={{ color: metric.strong }}>
              {metric.label}
            </p>

            {metric.progress && (
              <div
                className="mt-2.5 h-1 overflow-hidden rounded-full"
                style={{ backgroundColor: "color-mix(in srgb, var(--nav-amber) 20%, transparent)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    backgroundColor: "var(--nav-amber)",
                    // חסם עליון: אירוע שנמכר מעבר לקיבולת (סימון ידני, מקום
                    // שהתפנה) לא אמור לגלוש מהפס החוצה.
                    width: `${Math.min(100, Math.round((metric.progress.value / metric.progress.max) * 100))}%`,
                  }}
                />
              </div>
            )}

            <p className="mt-2 text-xs text-[var(--muted)]">{metric.context}</p>
          </Link>
        ))}
      </section>

      {/* ── היום · דורש טיפול ───────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-3">
          <h2 className="font-medium">היום</h2>
          {!bookings.length && !nextNewsletter ? (
            <p className="text-sm text-[var(--muted)]">אין פגישות היום.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bookings.map((booking) => {
                const eventType = eventTypeById.get(booking.event_type_id);
                return (
                  <li
                    key={booking.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                  >
                    <span className="font-medium tabular-nums">
                      {formatTime(new Date(booking.starts_at), bookingSettings.timezone)}
                    </span>
                    {eventType && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses(eventType.color)}`}
                      >
                        {eventType.name}
                      </span>
                    )}
                    {booking.contact_id ? (
                      <Link
                        href={`/contacts/${booking.contact_id}`}
                        className="text-[var(--muted)] hover:underline"
                      >
                        {booking.invitee_name}
                      </Link>
                    ) : (
                      <span className="text-[var(--muted)]">{booking.invitee_name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {nextNewsletter && (
            <p className="border-t border-[var(--border)] pt-3 text-sm">
              <Link href="/newsletter/scheduled" className="hover:underline">
                <span className="font-medium">ניוזלטר:</span>{" "}
                <span className="text-[var(--muted)]">
                  {nextNewsletter.subject}
                  {nextNewsletter.scheduled_at
                    ? ` · ${formatDateTime(new Date(nextNewsletter.scheduled_at), bookingSettings.timezone)}`
                    : ""}
                </span>
              </Link>
            </p>
          )}
        </div>

        <div className="card flex flex-col gap-3">
          <h2 className="font-medium">דורש טיפול</h2>
          {!quiet.length && !unpaidCount && !unlinkedInterestedCount ? (
            <p className="text-sm text-[var(--muted)]">הכול מטופל ✔</p>
          ) : !quiet.length ? null : (
            <ul className="flex flex-col gap-2">
              {quiet.map((contact) => (
                <li
                  key={contact.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
                >
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium hover:underline"
                  >
                    {contact.full_name || contact.phone || "ללא שם"}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses("orange")}`}
                  >
                    {daysSince(contact.last_incoming_message_at ?? contact.created_at, now)} ימים
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* מי שהשאירה פרטים, יצאה לתשלום ולא חזרה. יממה היא הסף שבו זה
              מפסיק להיות "היא עוד באמצע" ומתחיל להיות "צריך לפנות אליה". */}
          {Boolean(unpaidCount) && (
            <Link
              href="/events"
              className="flex items-baseline justify-between gap-3 border-t border-[var(--border)] pt-3 text-sm hover:underline"
            >
              <span className="font-medium">נרשמו לאירוע ולא שילמו</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses("rose")}`}
              >
                {unpaidCount}
              </span>
            </Link>
          )}

          {/* מתעניינת שאינה באף מסע היא ליד שנפל בין הכיסאות: היא השאירה
              פרטים, ואיש לא בנה לה המשך. הקישור מוביל למסעות, כי זו הפעולה
              שסוגרת את הפער. */}
          {Boolean(unlinkedInterestedCount) && (
            <Link
              href="/journeys"
              className="flex items-baseline justify-between gap-3 border-t border-[var(--border)] pt-3 text-sm hover:underline"
            >
              <span className="font-medium">מתעניינות שאינן באף מסע</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses("amber")}`}
              >
                {unlinkedInterestedCount}
              </span>
            </Link>
          )}

          <p className="mt-auto text-xs text-[var(--subtle)]">
            מי שלא נשמע ממנו {NO_REPLY_DAYS} ימים ומעלה.
          </p>
        </div>
      </section>

      {/* ── שורת מצב ────────────────────────────────────────────────── */}
      {/*
        המתזמן היה אמור לשבת כאן, אבל אין טבלה שרושמת את ריצות הקרון — ואין
        ממה לגזור "רץ לאחרונה ב-". במקומו נכנס כאן הכרטיס של הקורסים (0028).
      */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/whatsapp" className="card flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor: health.tone === "bad" ? "var(--danger-soft)" : "var(--nav-amber-soft)",
              color: health.tone === "bad" ? "var(--danger)" : "var(--nav-amber)",
            }}
          >
            <Bolt />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium break-words">{health.text}</span>
            <span className="block text-xs text-[var(--muted)]">
              ערוץ הוואטסאפ
              {phone?.displayPhoneNumber && (
                <>
                  {" · "}
                  {/* בלי dir המספר נשבר: הדפדפן מסדר את הקטעים שלו מימין לשמאל. */}
                  <span dir="ltr">{phone.displayPhoneNumber}</span>
                </>
              )}
            </span>
          </span>
        </Link>

        <Link href="/journeys" className="card flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor: "var(--nav-purple-soft)",
              color: "var(--nav-purple)",
            }}
          >
            <Route />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {enrolledCount ?? 0} אנשים במסעות כרגע
            </span>
            <span className="block text-xs text-[var(--muted)]">
              {activeJourneysCount ?? 0} מסעות פעילים
            </span>
          </span>
        </Link>

        <Link href="/courses" className="card flex items-center gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: "var(--nav-blue-soft)", color: "var(--nav-blue)" }}
          >
            <School />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              {courseInterestedCount} מתעניינות בקורסים
            </span>
            <span className="block text-xs text-[var(--muted)]">
              {newCourseInterestCount ?? 0} חדשות השבוע
            </span>
          </span>
        </Link>
      </section>
    </div>
  );
}
