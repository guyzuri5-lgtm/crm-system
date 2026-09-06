import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings } from "@/lib/booking/data";
import { utcToZonedParts, zonedTimeToUtc, zonedDateKey } from "@/lib/booking/timezone";
import { getWhatsAppSettings, recentDeliveryFailures } from "@/lib/whatsapp-throttle";
import { isWhatsAppConfigured, getPhoneNumberStatus } from "@/lib/whatsapp-cloud";

/**
 * הנתונים של דף הבית — מפוצלים לפי מקטע, ולא כערימה אחת.
 *
 * ── מה היה כאן קודם ──
 * `Promise.all` אחד עם עשרים ושלוש שאילתות **ועוד קריאת רשת אל Meta**, ואחריו
 * גל שני של שלוש. הן רצו במקביל, וזה היה נכון — אבל המסך כולו חיכה לאיטית
 * שבהן. קריאה ל-Graph API של Meta לוקחת בין חצי שנייה לשתיים, ובזמן הזה גם
 * הכותרת "בוקר טוב" לא הופיעה. מדד שנשלף ב-40 מילישניות המתין לה.
 *
 * ── מה עכשיו ──
 * כל מקטע במסך שולף את מה שהוא צריך בלבד, בתוך <Suspense> משלו: המסגרת
 * מצטיירת מיד, וכל מקטע נכנס כשהוא מוכן. מקטע איטי כבר אינו מעכב מקטע מהיר,
 * וקריאת Meta מעכבת שורת מצב אחת בתחתית ותו לא.
 *
 * ── למה cache() על החלקים המשותפים ──
 * שני מקטעים צריכים את מצב הערוץ, ושניים אחרים את פגישות היום. cache() של
 * React מאחד קריאות זהות בתוך אותה בקשה, ולכן הפיצול לא הפך שאילתה אחת
 * לשתיים. בלעדיו הפיצול היה מוזיל את ההמתנה ומייקר את העבודה.
 */

/** אזור הזמן שלפיו נמדדים "היום", "השבוע" ו"החודש" — אותו אחד ששאר המערכת מניחה. */
export const TIMEZONE = "Asia/Jerusalem";

/** כמה ימי שקט הופכים איש קשר ל"דורש טיפול". אותה יחידה שהכללים עובדים בה. */
export const NO_REPLY_DAYS = 3;

/** מעבר לזה, "לא נשמע ממנו" מפסיק להיות תזכורת ומתחיל להיות התראה. */
export const URGENT_DAYS = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * אורך חלון גרפי המגמה. ארבעה-עשר יום ולא חודש: מספר השורות שנשלפות נשאר
 * חסום, והצורה בקצה — זה שהעין קוראת — נשארת מדויקת.
 */
export const TREND_DAYS = 14;

/**
 * חסם על שתי שאילתות המגמה. הן שולפות שורות ולא ספירות, כי PostgREST לא
 * יודע לקבץ לפי יום בלי RPC — ומיגרציה חורגת מגבולות עבודת העיצוב. הסדר
 * יורד בכוונה: אם החסם ייגע אי-פעם, ייחתכו הימים הישנים ולא החדשים.
 */
const TREND_ROW_CAP = 3000;

/**
 * גבולות הזמן של המסך.
 *
 * ה-`now` נלכד פעם אחת לכל בקשה (cache) ולא בכל מקטע בנפרד: בלי זה שני
 * מקטעים שנשלפו בהפרש של חצי שנייה יכולים ליפול משני צדי חצות, ואז "היום"
 * של ציר הזמן אינו "היום" של המדדים.
 *
 * כל הגבולות נחתכים לפי שעון ישראל ולא לפי UTC — אחרת "היום" מתחיל בשלוש
 * לפנות בוקר, ופגישה של תשע בערב נופלת למחר.
 */
export const bounds = cache(() => {
  const now = new Date();
  const { year, month, day, weekday, minutes } = utcToZonedParts(now, TIMEZONE);
  return {
    now,
    minutes,
    startOfToday: zonedTimeToUtc(year, month, day, 0, TIMEZONE),
    endOfToday: zonedTimeToUtc(year, month, day + 1, 0, TIMEZONE),
    // סוף השבוע הישראלי: מוצאי שבת. weekday 0 = ראשון.
    endOfWeek: zonedTimeToUtc(year, month, day + (6 - weekday) + 1, 0, TIMEZONE),
    startOfMonth: zonedTimeToUtc(year, month, 1, 0, TIMEZONE),
    sevenDaysAgo: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
    noReplyCutoff: new Date(now.getTime() - NO_REPLY_DAYS * DAY_MS).toISOString(),
    trendFrom: zonedTimeToUtc(year, month, day - (TREND_DAYS - 1), 0, TIMEZONE).toISOString(),
  };
});

/**
 * ספירה ליום לאורך TREND_DAYS הימים האחרונים, מהישן לחדש. הקיבוץ נעשה לפי
 * שעון ישראל ולא לפי UTC — אחרת הודעה שיצאה בעשר בערב נספרת למחרת.
 */
export function dailyCounts(rows: { created_at: string }[] | null, now: Date): number[] {
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

export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return "עדיין לא נשלחה הודעה";
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return `לפני ${Math.floor(hours / 24)} ימים`;
}

export function daysSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

/** "נקבע היום" רק כשזה באמת חדש — פגישה שנקבעה לפני שבוע היא סתם פגישה. */
export function bookedRecently(iso: string, now: Date): string | null {
  const days = daysSince(iso, now);
  if (days === 0) return "נקבע היום";
  if (days === 1) return "נקבע אתמול";
  return null;
}

/* ── קריאות משותפות ─────────────────────────────────────────────────────── */

/** פגישות היום. נחוצות גם למדד "פגישות השבוע" וגם לציר הזמן. */
export const todayBookings = cache(async () => {
  const { startOfToday, endOfToday } = bounds();
  const { data } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("status", "confirmed")
    .gte("starts_at", startOfToday.toISOString())
    .lt("starts_at", endOfToday.toISOString())
    .order("starts_at");
  return data ?? [];
});

/** מצב הערוץ בשורה אחת. bad צובע את הכרטיס באדום, warn משאיר אותו בענבר. */
export type Health = { text: string; tone: "ok" | "warn" | "bad" };

function whatsappHealth(
  configured: boolean,
  paused: boolean,
  statusError: string | null,
  qualityRating: string | null,
  deliveryFailures: number
): Health {
  if (!configured) return { text: "לא מוגדר", tone: "bad" };
  // מתג ההשהיה חוסם שליחה בשקט, ולכן הוא חייב להיראות דווקא כאן.
  if (paused) return { text: "מושהה", tone: "bad" };
  if (statusError) return { text: statusError, tone: "bad" };
  // כשל מסירה קודם לדירוג האיכות: האיכות אומרת אם נמענים מתלוננים, לא אם
  // ההודעות בכלל נמסרות. ב-5.9.2026 הכרטיס הזה הציג "תקין" בזמן שכל תבנית
  // נדחתה על תקלת חיוב — והמסך היה הדבר היחיד שיכול היה לספר על כך.
  if (deliveryFailures > 0) return { text: "הודעות לא נמסרות", tone: "bad" };
  if (qualityRating === "RED") return { text: "איכות נמוכה", tone: "bad" };
  if (qualityRating === "YELLOW") return { text: "איכות יורדת", tone: "warn" };
  return { text: "תקין", tone: "ok" };
}

/**
 * מצב ערוץ הוואטסאפ, כולל הקריאה ל-Meta.
 *
 * זו הקריאה היקרה במסך — היא יוצאת לרשת החוצה אל Graph API. היא מבודדת כאן
 * ונקראת רק מהמקטעים שבאמת מציגים אותה, כדי שהיא לא תעכב את שאר המסך.
 * נכשלת בנפרד ולא מפילה דבר.
 */
export const channelHealth = cache(async () => {
  const configured = isWhatsAppConfigured();

  const [settings, phoneStatus, failures, lastOut] = await Promise.all([
    getWhatsAppSettings(),
    configured
      ? getPhoneNumberStatus().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : Promise.resolve(null),
    recentDeliveryFailures(),
    supabaseAdmin()
      .from("interactions")
      .select("created_at")
      .eq("type", "whatsapp_out")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const statusError = phoneStatus && "error" in phoneStatus ? phoneStatus.error : null;
  const phone = phoneStatus && !("error" in phoneStatus) ? phoneStatus : null;
  const health = whatsappHealth(
    configured,
    settings.paused,
    statusError,
    phone?.qualityRating ?? null,
    failures.count
  );

  return {
    health,
    phone,
    lastSentAt: lastOut.data?.created_at ?? null,
    color:
      health.tone === "bad"
        ? "var(--danger)"
        : health.tone === "warn"
          ? "var(--warn)"
          : "var(--ok)",
    soft:
      health.tone === "bad"
        ? "var(--danger-soft)"
        : health.tone === "warn"
          ? "var(--warn-soft)"
          : "var(--ok-soft)",
  };
});

/** האירוע הקרוב, וכמה שילמו אליו. משמש את הכרטיס הרביעי במדדים. */
export const nextEventWithPaid = cache(async () => {
  const { now } = bounds();
  const db = supabaseAdmin();

  // אם 0024 טרם רצה השגיאה נבלעת, הנתון פשוט לא מוצג, ודף הבית ממשיך לעבוד.
  const { data: event } = await db
    .from("events")
    .select("id, name, starts_at, capacity")
    .eq("active", true)
    .gte("starts_at", now.toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();

  if (!event) return null;

  const { count } = await db
    .from("event_registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id)
    .eq("stage", "paid");

  return { event, paid: count ?? 0 };
});

/** ספירות המסעות — מופיעות גם בכרטיס מדד וגם בשורת המצב. */
export const journeyCounts = cache(async () => {
  const db = supabaseAdmin();
  const [{ count: active }, { count: enrolled }] = await Promise.all([
    db.from("journeys").select("id", { count: "exact", head: true }).eq("active", true),
    db.from("journey_enrollments").select("id", { count: "exact", head: true }).eq("state", "active"),
  ]);
  return { active: active ?? 0, enrolled: enrolled ?? 0 };
});

/** אזור הזמן שציר היום מצויר לפיו. שאילתה אחת, שני מקטעים. */
export const dayZone = cache(async () => (await getBookingSettings()).timezone);

export { TREND_ROW_CAP };
