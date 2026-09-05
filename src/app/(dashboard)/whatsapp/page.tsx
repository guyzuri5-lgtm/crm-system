import type { CSSProperties } from "react";
import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { getWhatsAppSettings, countWhatsAppSentToday } from "@/lib/whatsapp-throttle";
import { isWhatsAppConfigured, getPhoneNumberStatus } from "@/lib/whatsapp-cloud";

export const dynamic = "force-dynamic";

/**
 * הדירוג ש-Meta נותנת למספר, לפי תלונות וחסימות של נמענים.
 *
 * זו ההתראה המוקדמת היחידה לפני הגבלה בפועל, והיא לא מגיעה לשום מקום אחר
 * אלא אם בודקים — ולכן היא כאן, ולא קבורה בממשק של Meta.
 */
const QUALITY = {
  GREEN: { text: "תקין", tone: "ok" as const, hint: "אין תלונות חריגות מנמענים." },
  YELLOW: {
    text: "יורד",
    tone: "warn" as const,
    hint: "הצטברו תלונות. כדאי לצמצם פניות יזומות ולבדוק את נוסח התבניות.",
  },
  RED: {
    text: "נמוך",
    tone: "bad" as const,
    hint: "Meta עלולה להגביל את המספר. מומלץ להשהות שליחה אוטומטית ולבדוק למי נשלח.",
  },
};

export default async function WhatsAppPage() {
  await verifyTeamMember();

  const settings = await getWhatsAppSettings();
  const configured = isWhatsAppConfigured();

  // שתי הקריאות יכולות להיכשל בנפרד, ואף אחת מהן אינה סיבה להפיל את הדף —
  // זה גם הדף שבו משהים את השליחה כשמשהו משתבש.
  const [sentToday, status] = await Promise.all([
    countWhatsAppSentToday().catch(() => null),
    configured
      ? getPhoneNumberStatus().catch((error: unknown) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : Promise.resolve(null),
  ]);

  const statusError = status && "error" in status ? status.error : null;
  const phone = status && !("error" in status) ? status : null;
  const quality = phone?.qualityRating
    ? (QUALITY[phone.qualityRating as keyof typeof QUALITY] ?? null)
    : null;

  const remaining = sentToday === null ? null : Math.max(0, settings.daily_limit - sentToday);

  return (
    <div className="flex flex-col gap-8">
      <div className="h-page">
        <div>
          <h1>ערוץ הוואטסאפ</h1>
          <p>מצב המספר אצל Meta: איכות, תקרה יומית, וכמה כבר נשלח היום.</p>
        </div>
        {phone?.displayPhoneNumber && (
          <>
            <span className="flex-1" />
            <span className="pill" style={pillStyle("var(--ok)", "var(--ok-soft)")}>
              מחובר ·{" "}
              <span className="data" dir="ltr">
                {phone.displayPhoneNumber}
              </span>
            </span>
          </>
        )}
      </div>

      {/* ── מצב ─────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-sm text-[var(--muted)]">איכות המספר</p>
          {!configured ? (
            <p className="mt-1 font-medium text-[var(--danger)]">לא מוגדר</p>
          ) : statusError ? (
            <p className="mt-1 text-sm font-medium text-[var(--danger)]">{statusError}</p>
          ) : quality ? (
            <>
              <p
                className="mt-1 text-[22px] leading-none font-medium tracking-[-0.02em]"
                style={{
                  fontFamily: "var(--font-display)",
                  color:
                    quality.tone === "ok"
                      ? "var(--ok)"
                      : quality.tone === "warn"
                        ? "var(--warn)"
                        : "var(--danger)",
                }}
              >
                {quality.text}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--subtle)]">{quality.hint}</p>
            </>
          ) : (
            <p className="mt-1 font-medium text-[var(--muted)]">—</p>
          )}
        </div>

        <div className="card">
          <p className="text-sm text-[var(--muted)]">נשלחו היום</p>
          {/* טבעת ולא מספר יבש: כשהמכסה מתמלאת רואים את זה לפני שהשליחה
              נעצרת, ולא רק אחרי. */}
          <div className="mt-2.5 flex items-center gap-3.5">
            <QuotaRing value={sentToday ?? 0} max={settings.daily_limit} />
            <div>
              <p className="text-[25px] leading-none font-medium tracking-[-0.02em] tabular-nums"
                 style={{ fontFamily: "var(--font-display)" }}>
                {sentToday ?? "—"}
                <span className="text-sm text-[var(--subtle)]"> / {settings.daily_limit}</span>
              </p>
              <p className="mt-1.5 text-[11.5px] text-[var(--subtle)]">
                {sentToday === null
                  ? "אין נתון"
                  : `${Math.round((sentToday / settings.daily_limit) * 100)}% מהתקרה היומית`}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <p className="text-sm text-[var(--muted)]">נותרו היום</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {settings.paused ? "מושהה" : (remaining ?? "—")}
          </p>
          {phone?.messagingLimitTier && (
            <p className="mt-1 text-xs text-[var(--subtle)]">
              תקרת Meta: {phone.messagingLimitTier.replace("TIER_", "")}
            </p>
          )}
        </div>
      </section>

      {/* ── בלמים ───────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="font-medium">בלמים על השליחה האוטומטית</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          {settings.paused ? (
            <>
              השליחה האוטומטית <strong className="text-[var(--danger)]">מושהית</strong>.
              הקרון היומי אינו שולח דבר; שליחה ידנית מכרטיס לקוח ממשיכה לעבוד.
            </>
          ) : (
            <>
              השליחה האוטומטית פעילה, עם תקרה של <strong>{settings.daily_limit}</strong>{" "}
              תבניות ביום.
            </>
          )}{" "}
          את התקרה ואת מתג ההשהיה משנים ב
          <Link href="/settings/sending" className="underline">
            הגדרות ← בלמי שליחה
          </Link>
          .
        </p>
      </section>

      {/* ── חלון 24 השעות ───────────────────────────────────────────── */}
      <section className="card">
        <h2 className="font-medium">חלון 24 השעות — מה מותר לשלוח למי</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          זה הכלל היחיד שקובע הכול. בכל רגע, כל איש קשר נמצא באחד משני מצבים:
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">מצב</th>
                <th className="th">מתי</th>
                <th className="th">מה מותר</th>
                <th className="th">עלות</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border)]">
                <td className="td font-medium text-[var(--ok)]">חלון פתוח</td>
                <td className="td">הלקוח כתב ב-24 השעות האחרונות</td>
                <td className="td">כל טקסט חופשי</td>
                <td className="td">חינם</td>
              </tr>
              <tr>
                <td className="td font-medium text-[var(--muted)]">חלון סגור</td>
                <td className="td">לא כתב, או שמעולם לא כתב</td>
                <td className="td">רק תבנית מאושרת</td>
                <td className="td">מחויב</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">
          כרטיס הלקוח מציג את המצב הנוכחי ומאפשר רק את מה שחוקי בו. כלל אוטומציה של
          מעקב פונה מעצם טבעו למי שלא ענה — כלומר כמעט תמיד מחוץ לחלון — ולכן{" "}
          <strong>לכל כלל כזה חייבת להיות תבנית מאושרת</strong>, אחרת השליחה תיכשל.
        </p>
      </section>
    </div>
  );
}

function pillStyle(color: string, soft: string): CSSProperties {
  return { "--pill-color": color, "--pill-bg": soft } as CSSProperties;
}

/**
 * טבעת המכסה היומית. r=22 ולכן ההיקף הוא 2πr; ה-offset הוא מה שנשאר ריק,
 * והסיבוב ב-90 מעלות מתחיל אותה מלמעלה במקום מימין.
 */
function QuotaRing({ value, max }: { value: number; max: number }) {
  const R = 22;
  const circumference = 2 * Math.PI * R;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const full = pct >= 0.9;

  return (
    <svg width={54} height={54} viewBox="0 0 54 54" aria-label={`${value} מתוך ${max}`} role="img">
      <circle cx="27" cy="27" r={R} fill="none" stroke="var(--surface-sunken)" strokeWidth={6} />
      <circle
        cx="27"
        cy="27"
        r={R}
        fill="none"
        stroke={full ? "var(--warn)" : "var(--primary)"}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circumference.toFixed(1)}
        strokeDashoffset={(circumference * (1 - pct)).toFixed(1)}
        transform="rotate(-90 27 27)"
      />
    </svg>
  );
}
