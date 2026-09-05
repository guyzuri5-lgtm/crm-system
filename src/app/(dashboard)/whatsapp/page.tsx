import type { CSSProperties } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { WindowMeter } from "@/components/window-meter";
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

  // התבניות המאושרות שייכות למסך הזה: כשבודקים את מצב הערוץ, השאלה הבאה
  // היא תמיד "ומה בכלל מותר לי לשלוח מחוץ לחלון". הן לקריאה בלבד כאן —
  // העריכה נשארת ב"תבניות הודעה".
  const { data: templatesRaw } = await supabaseAdmin()
    .from("message_templates")
    .select("id, name, meta_template_name, meta_category, meta_status")
    .eq("channel", "whatsapp")
    .not("meta_template_name", "is", null)
    .order("name");
  const templates = templatesRaw ?? [];

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
        <h2 className="card-title">בלמים על השליחה האוטומטית</h2>
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
        <h2 className="card-title">חלון 24 השעות — מה מותר לשלוח למי</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          זה הכלל היחיד שקובע הכול. בכל רגע, כל איש קשר נמצא באחד משני מצבים:
        </p>

        {/*
          שני כרטיסים ולא טבלה בת שתי שורות. אותם שלושה שדות בשניהם ובאותו
          סדר — מתי, מה מותר, כמה עולה — כדי שההשוואה תהיה מיידית ולא תדרוש
          לרוץ עם העין לאורך שורה.
        */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <WindowRule
            open
            title="חלון פתוח"
            when="הלקוח כתב ב-24 השעות האחרונות"
            allowed="כל טקסט חופשי"
            cost="חינם"
            costTone="var(--ok)"
          />
          <WindowRule
            open={false}
            title="חלון סגור"
            when="לא כתב, או שמעולם לא כתב"
            allowed="רק תבנית שאושרה מראש ב-Meta"
            cost="מחויב לפי הודעה"
          />
        </div>

        <p
          className="mt-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed"
          style={{ backgroundColor: "var(--warn-soft)", color: "var(--warn)" }}
        >
          <svg
            width={15}
            height={15}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <path d="M12 9.5v4M12 17.2h.01" />
          </svg>
          <span>
            כלל אוטומציה או מסע מעקב פונים מעצם טבעם למי שלא ענה — כלומר כמעט תמיד מחוץ
            לחלון. <strong>לכל שלב כזה חייבת להיות תבנית מאושרת</strong>, אחרת השליחה
            תיכשל בשקט.
          </span>
        </p>
      </section>

      {/* ── תבניות מאושרות ──────────────────────────────────────────── */}
      <section className="card flex flex-col p-0">
        <div className="card-h">
          <h2>תבניות מאושרות</h2>
          <span className="flex-1" />
          <Link href="/templates" className="btn-ghost text-xs">
            ניהול תבניות
          </Link>
        </div>

        {templates.length === 0 ? (
          <div className="card-b">
            <p className="py-2 text-sm text-[var(--muted)]">
              אין עדיין תבנית שאושרה ב-Meta. בלעדיה אי אפשר לפנות למי שמחוץ לחלון —
              כלומר כמעט לכל מסע מעקב.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th">שם</th>
                    <th className="th">מזהה ב-Meta</th>
                    <th className="th">קטגוריה</th>
                    <th className="th">מצב</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr
                      key={t.id}
                      className="tr-hover border-b border-[var(--border)] last:border-0"
                    >
                      <td className="td font-medium">{t.name}</td>
                      <td className="td data text-[var(--muted)]" dir="ltr">
                        {t.meta_template_name}
                      </td>
                      <td className="td text-[var(--muted)]">
                        {META_CATEGORY[t.meta_category ?? ""] ?? t.meta_category ?? "—"}
                      </td>
                      <td className="td">
                        <MetaStatusPill status={t.meta_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-f">
              רק תבנית שאושרה ב-Meta ניתנת לשליחה מחוץ לחלון 24 השעות, והיא מחויבת.
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const META_CATEGORY: Record<string, string> = {
  MARKETING: "שיווק",
  UTILITY: "שירות",
  AUTHENTICATION: "אימות",
};

/** מצב האישור אצל Meta. תמונת מצב מסונכרנת, לא מקור אמת — ולכן רק תצוגה. */
function MetaStatusPill({ status }: { status: string | null }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    APPROVED: { label: "אושרה", color: "var(--ok)", bg: "var(--ok-soft)" },
    PENDING: { label: "בבדיקה", color: "var(--warn)", bg: "var(--warn-soft)" },
    REJECTED: { label: "נדחתה", color: "var(--danger)", bg: "var(--danger-soft)" },
    PAUSED: { label: "מושהית", color: "var(--warn)", bg: "var(--warn-soft)" },
    DISABLED: { label: "מושבתת", color: "var(--danger)", bg: "var(--danger-soft)" },
  };
  const tone = map[status ?? ""] ?? {
    label: status ?? "לא סונכרנה",
    color: "var(--muted)",
    bg: "var(--surface-sunken)",
  };
  return (
    <span
      className="pill"
      style={{ "--pill-color": tone.color, "--pill-bg": tone.bg } as CSSProperties}
    >
      {tone.label}
    </span>
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

/**
 * כרטיס אחד משני מצבי החלון. אותו מבנה בשניהם — זה כל העניין: מה שמשתנה
 * ביניהם הוא התוכן, לא הצורה, ולכן ההבדל נקרא מיד.
 */
function WindowRule({
  open,
  title,
  when,
  allowed,
  cost,
  costTone,
}: {
  open: boolean;
  title: string;
  when: string;
  allowed: string;
  cost: string;
  costTone?: string;
}) {
  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl border p-3.5"
      style={
        open
          ? {
              backgroundColor: "color-mix(in srgb, var(--ok-soft) 55%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--ok) 35%, transparent)",
            }
          : { backgroundColor: "var(--surface)", borderColor: "var(--border)" }
      }
    >
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <WindowMeter openWindow={open} hoursLeft={open ? 19 : 0} />
        {title}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-xs">
        <dt className="text-[var(--muted)]">מתי</dt>
        <dd>{when}</dd>
        <dt className="text-[var(--muted)]">מה מותר</dt>
        <dd>{allowed}</dd>
        <dt className="text-[var(--muted)]">עלות</dt>
        <dd className="font-medium" style={costTone ? { color: costTone } : undefined}>
          {cost}
        </dd>
      </dl>
    </div>
  );
}
