import { Suspense } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { bounds, TIMEZONE } from "./_home/data";
import { Metrics, MetricsFallback } from "./_home/metrics";
import { Today, TodayFallback } from "./_home/today";
import { Attention, AttentionFallback } from "./_home/attention";
import { StatusRow, StatusRowFallback } from "./_home/status-row";

export const dynamic = "force-dynamic";

/**
 * דף הבית — מסגרת בלבד.
 *
 * ── מה השתנה כאן ──
 * קודם העמוד הזה שלף עשרים ושלוש שאילתות ועוד קריאת רשת אל Meta לפני
 * שהחזיר את התו הראשון של ה-HTML. הכול רץ במקביל, אבל המסך כולו חיכה לאיטית
 * שבהן — ובפועל זו הייתה קריאת Meta, בין חצי שנייה לשתיים. גם המילה
 * "בוקר טוב", שאינה תלויה בכלום, הופיעה רק אחריה.
 *
 * עכשיו הקובץ הזה אינו שולף דבר. כל מקטע הוא רכיב שרת עצמאי בתוך
 * <Suspense> משלו, שולף רק את מה שהוא מציג, ומגיע כשהוא מוכן. הכותרת
 * והתאריך נצבעים מיד; המדדים אחריהם; שורת המצב, שממתינה ל-Meta, אחרונה.
 *
 * המקטעים אינם ממתינים זה לזה — הם נשלחים לדפדפן בזרם, לפי סדר הסיום.
 */

/** "יום רביעי" · "כ״ב באלול" · "2 בספטמבר 2026" — שלושה חלקים, לא מחרוזת אחת. */
function dateParts(now: Date): { weekday: string; hebrew: string; gregorian: string } {
  const weekday = new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    weekday: "long",
  }).format(now);
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

function greeting(hourInIsrael: number): string {
  if (hourInIsrael < 12) return "בוקר טוב";
  if (hourInIsrael < 17) return "צהריים טובים";
  return "ערב טוב";
}

export default async function DashboardPage() {
  const { email } = await verifyTeamMember();
  const { now, minutes } = bounds();
  const { weekday, hebrew, gregorian } = dateParts(now);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="text-[26px] font-medium tracking-[-0.025em] [font-family:var(--font-display)]">
          {greeting(Math.floor(minutes / 60))}
          {email ? `, ${email.split("@")[0]}` : ""}
        </h1>
        <p className="text-[12.5px] text-[var(--subtle)]">
          <b className="font-medium text-[var(--muted)]">{weekday}</b> · {hebrew} · {gregorian}
        </p>
      </div>

      {/* ── ארבעה מדדים ─────────────────────────────────────────────── */}
      <Suspense fallback={<MetricsFallback />}>
        <Metrics />
      </Suspense>

      {/* ── היום · דורש טיפול ───────────────────────────────────────── */}
      {/* היום רחב יותר: ציר זמן צריך מקום לשמות מלאים, ורשימת המשימות לא.
          שני הכרטיסים ב-Suspense נפרד — אין סיבה שספירת המתעניינות תעכב את
          ציר הפגישות. */}
      <section className="grid gap-3.5 lg:grid-cols-[1.15fr_0.85fr]">
        <Suspense fallback={<TodayFallback />}>
          <Today />
        </Suspense>
        <Suspense fallback={<AttentionFallback />}>
          <Attention />
        </Suspense>
      </section>

      {/* ── שורת מצב ────────────────────────────────────────────────── */}
      <Suspense fallback={<StatusRowFallback />}>
        <StatusRow />
      </Suspense>
    </div>
  );
}
