import type { CSSProperties } from "react";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { Avatar } from "@/components/avatar";
import { formatDate, formatDateTime } from "@/lib/dates";
import { readWhatsAppSettings, countWhatsAppSentToday } from "@/lib/whatsapp-throttle";
import { warmupState } from "@/lib/whatsapp-warmup";
import { phoneFromWaId } from "@/lib/whatsapp-cloud";
import { getBridgeStatus, isBridgeConfigured, type BridgeStatus } from "@/lib/whatsapp-bridge";
import {
  requestPairingCodeAction,
  saveWhatsAppBrakesAction,
  sendTestToSelfAction,
} from "./actions";
import { BrakesForm } from "./brakes-form";
import { PairingPanel, TestToSelfButton } from "./bridge-controls";

export const dynamic = "force-dynamic";

/**
 * דף הוואטסאפ — המספר העסקי שמחובר דרך הגשר (src/lib/whatsapp-bridge.ts).
 *
 * עד 24.11.2026 הדף הזה היה בנוי סביב הערוץ הרשמי של מטא: דירוג איכות, חלון
 * 24 שעות ותבניות מאושרות. בגשר אין אף אחד מהם. מה שכן חשוב עכשיו: האם
 * הגשר מחובר, מה קרה להודעות, ומה מגן על המספר מחסימה.
 */

/** תקופת הניסיון בגוגל קלאוד, שבה רץ שרת הגשר. אחריה השרת נכבה בלי Upgrade. */
const CLOUD_TRIAL_ENDS = "2027-02-09";

/** המספר שמחובר לגשר. מוצג כברירת מחדל במסך החיבור. */
const DEFAULT_PAIRING_PHONE = "055-269-0416";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function WhatsAppPage() {
  await verifyTeamMember();

  const configured = isBridgeConfigured();
  const { since, trialActive } = clock();
  const db = supabaseAdmin();

  // גל אחד. אף אחת מהקריאות לא תלויה באחרת, ואף אחת לא מפילה את הדף —
  // זה גם הדף שבו עוצרים את השליחה כשמשהו משתבש.
  const [{ settings, degraded }, sentToday, bridge, recentRaw, outWeek, inWeek] =
    await Promise.all([
      readWhatsAppSettings(),
      countWhatsAppSentToday().catch(() => null),
      configured
        ? getBridgeStatus().catch((): null => null)
        : Promise.resolve(null as BridgeStatus | null),
      db
        .from("interactions")
        .select("id, type, content, created_at, external_id, contact_id, contacts(full_name, phone)")
        .in("type", ["whatsapp_in", "whatsapp_out"])
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("interactions")
        .select("external_id")
        .eq("type", "whatsapp_out")
        .gte("created_at", since)
        .not("external_id", "is", null)
        .limit(500),
      db
        .from("interactions")
        .select("contact_id")
        .eq("type", "whatsapp_in")
        .gte("created_at", since)
        .limit(1000),
    ]);

  // ── אישורי מסירה ──
  const recentRows = (recentRaw.data ?? []) as unknown as RecentRow[];
  const weekIds = (outWeek.data ?? []).map((r) => r.external_id as string);
  const recentOutIds = recentRows
    .filter((r) => r.type === "whatsapp_out" && r.external_id)
    .map((r) => r.external_id as string);
  const receiptIds = Array.from(new Set([...weekIds, ...recentOutIds]));
  const { data: receiptsRaw } = receiptIds.length
    ? await db
        .from("message_receipts")
        .select("external_id, delivered_at, opened_at, failed_at")
        .in("external_id", receiptIds)
    : { data: [] };
  const receipts = new Map((receiptsRaw ?? []).map((r) => [r.external_id, r]));

  const weekSent = weekIds.length;
  const weekDelivered = weekIds.filter((id) => {
    const r = receipts.get(id);
    return r && (r.delivered_at || r.opened_at);
  }).length;
  const weekRead = weekIds.filter((id) => receipts.get(id)?.opened_at).length;
  const repliedContacts = new Set((inWeek.data ?? []).map((r) => r.contact_id)).size;

  // ── מי מחכה לתשובה: אנשי קשר שההודעה האחרונה שלהם ברשימה היא נכנסת ──
  const latestByContact = new Map<string, RecentRow>();
  for (const row of recentRows) {
    if (!latestByContact.has(row.contact_id)) latestByContact.set(row.contact_id, row);
  }
  const awaiting = new Set(
    Array.from(latestByContact.values())
      .filter((r) => r.type === "whatsapp_in")
      .map((r) => r.contact_id)
  );

  const warmup = warmupState({
    dailyLimit: settings.daily_limit,
    warmupEnabled: settings.warmup_enabled,
    warmupStartedAt: settings.warmup_started_at,
  });

  const connected = bridge?.connection === "open";
  const number = bridge?.me ? phoneFromWaId(bridge.me) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="h-page">
        <div>
          <h1>וואטסאפ</h1>
          <p>המספר העסקי שממנו ה-CRM שולח ומקבל הודעות, מה קרה איתן, והבלמים שמגנים עליו מחסימה.</p>
        </div>
        <span className="flex-1" />
        {connected ? (
          <span className="pill" style={pillStyle("var(--ok)", "var(--ok-soft)")}>
            מחובר
            {number && (
              <>
                {" · "}
                <span className="data" dir="ltr">
                  {number}
                </span>
              </>
            )}
          </span>
        ) : (
          <span className="pill" style={pillStyle("var(--danger)", "var(--danger-soft)")}>
            {configured ? "מנותק" : "לא מוגדר"}
          </span>
        )}
      </div>

      {!configured && (
        <Notice tone="danger" title="הגשר לא מוגדר">
          חסרים WHATSAPP_BRIDGE_URL ו-WHATSAPP_BRIDGE_SECRET בהגדרות של ורסל, ולכן ה-CRM לא יודע
          לאן לשלוח.
        </Notice>
      )}

      {configured && !bridge && (
        <Notice tone="danger" title="שרת הגשר לא עונה">
          ייתכן שהשרת בגוגל קלאוד כבוי, או שכתובת ה-IP שלו השתנתה. בלי שרת, שום הודעה לא יוצאת.
        </Notice>
      )}

      {configured && bridge && !connected && (
        <>
          <Notice tone="danger" title="ה-CRM לא מחובר לוואטסאפ, ושום הודעה לא יוצאת">
            המכשיר המקושר הוסר מהטלפון, או שהטלפון לא התחבר לאינטרנט יותר משבועיים.
            {bridge.queued > 0 &&
              ` ${bridge.queued} הודעות אוטומטיות מחכות בתור ויישלחו מיד אחרי החיבור.`}
          </Notice>
          <PairingPanel defaultPhone={DEFAULT_PAIRING_PHONE} onRequest={requestPairingCodeAction} />
        </>
      )}

      {connected && (
        <section className="card flex flex-wrap items-center gap-5">
          <span
            className="glyph size-[52px] rounded-[15px]"
            style={{ backgroundColor: "var(--ok-soft)", color: "var(--ok)" }}
            aria-hidden="true"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
              <path d="M10.5 18h3" />
              <path d="m9 10.5 2 2 4-4" />
            </svg>
          </span>
          <div className="min-w-0 flex-[1_1_320px]">
            <p className="text-[17px] font-medium" style={{ fontFamily: "var(--font-display)" }}>
              הגשר מחובר לוואטסאפ ביזנס
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)]">
              המספר{" "}
              <span className="data" dir="ltr">
                {number ?? "—"}
              </span>{" "}
              מחובר כמכשיר מקושר. הטלפון ממשיך לעבוד כרגיל, ומה שנכתב באחד מופיע גם בשני.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[11.5px] text-[var(--subtle)]">
              <span>
                מחובר מאז:{" "}
                <strong className="font-medium text-[var(--foreground)]">
                  {formatDateTime(bridge?.since, { dateStyle: "short", timeStyle: "short" })}
                </strong>
              </span>
              {bridge?.lastInboundAt && (
                <span>
                  הודעה נכנסת אחרונה:{" "}
                  <strong className="font-medium text-[var(--foreground)]">
                    {formatDateTime(bridge.lastInboundAt, { dateStyle: "short", timeStyle: "short" })}
                  </strong>
                </span>
              )}
              {bridge && bridge.queued > 0 && (
                <span>
                  בתור לשליחה:{" "}
                  <strong className="font-medium text-[var(--foreground)]">{bridge.queued}</strong>
                </span>
              )}
            </div>
          </div>
          <TestToSelfButton onSend={sendTestToSelfAction} />
        </section>
      )}

      {/* ── מדדים ───────────────────────────────────────────────────── */}
      <section className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        <div className="metric">
          <p className="text-[12.5px] text-[var(--muted)]">נשלחו היום</p>
          <div className="mt-2.5 flex items-center gap-3.5">
            <QuotaRing value={sentToday ?? 0} max={warmup.effectiveLimit} />
            <div>
              <p className="metric-value text-[27px]">
                {sentToday ?? "—"}
                <span className="text-sm text-[var(--subtle)]"> / {warmup.effectiveLimit}</span>
              </p>
              <p className="mt-1.5 text-[11.5px] text-[var(--subtle)]">
                {sentToday === null
                  ? "אין נתון"
                  : `נותרו ${Math.max(0, warmup.effectiveLimit - sentToday)} עד התקרה`}
              </p>
            </div>
          </div>
        </div>
        <Metric
          label="נמסרו · 7 ימים"
          value={weekSent ? `${Math.round((weekDelivered / weekSent) * 100)}%` : "—"}
          context={weekSent ? `${weekDelivered} מתוך ${weekSent} הגיעו למכשיר` : "עוד לא נשלח כלום"}
          color={weekSent ? "var(--ok)" : undefined}
        />
        <Metric
          label="נקראו · 7 ימים"
          value={weekSent ? `${Math.round((weekRead / weekSent) * 100)}%` : "—"}
          context={weekSent ? `וי כחול אצל ${weekRead}` : "עוד לא נשלח כלום"}
        />
        <Metric label="ענו לך · 7 ימים" value={String(repliedContacts)} context="אנשים שכתבו בחזרה" />
      </section>

      <div className="flex flex-wrap items-start gap-[18px]">
        {/* ── הודעות אחרונות ─────────────────────────────────────────── */}
        <section className="card min-w-0 flex-[999_1_560px] p-0">
          <div className="card-h">
            <h2>הודעות אחרונות</h2>
            {awaiting.size > 0 && (
              <span className="pill" style={pillStyle("var(--primary)", "var(--primary-soft)")}>
                {awaiting.size === 1 ? "אחת מחכה לתשובה" : `${awaiting.size} מחכות לתשובה`}
              </span>
            )}
            <span className="flex-1" />
            <Link href="/active" className="text-xs text-[var(--primary)] hover:underline">
              כל השיחות ←
            </Link>
          </div>

          {recentRows.length === 0 ? (
            <div className="card-b">
              <p className="py-2 text-sm text-[var(--muted)]">עוד אין הודעות בוואטסאפ.</p>
            </div>
          ) : (
            <ul>
              {recentRows.map((row) => {
                const name = row.contacts?.full_name || row.contacts?.phone || "ללא שם";
                const failed = row.content?.startsWith("[לא נמסר");
                const receipt = row.external_id ? receipts.get(row.external_id) : undefined;
                const highlight =
                  row.type === "whatsapp_in" &&
                  awaiting.has(row.contact_id) &&
                  latestByContact.get(row.contact_id)?.id === row.id;
                return (
                  <li key={row.id} className="border-b border-[var(--border)] last:border-0">
                    <Link
                      href={`/contacts/${row.contact_id}`}
                      className="inbox-row flex items-center gap-3 px-[18px] py-3"
                      {...(highlight ? { "data-unanswered": "" } : {})}
                    >
                      <Avatar name={name} className="size-[34px] shrink-0 rounded-[10px] text-[13px]" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold">
                          {name}{" "}
                          <span className="text-[11.5px] font-normal text-[var(--subtle)]">
                            · {row.type === "whatsapp_in" ? "נכנסת" : "יוצאת"}
                          </span>
                        </p>
                        <p className="mt-0.5 truncate text-[12.5px] text-[var(--muted)]">
                          {cleanContent(row.content)}
                        </p>
                      </div>
                      {row.type === "whatsapp_out" && (
                        <DeliveryMark failed={!!failed || !!receipt?.failed_at} receipt={receipt} />
                      )}
                      <span className="data shrink-0 text-[11px] text-[var(--subtle)]">
                        {shortTime(row.created_at)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="card-f">
            לחיצה על שורה פותחת את כרטיס איש הקשר עם כל השיחה. שורה מודגשת = הלקוח כתב אחרון ועוד
            לא ענית.
          </div>
        </section>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-[18px]">
          {/* ── בלמים ─────────────────────────────────────────────────── */}
          <section className="card">
            <h2 className="card-title">בלמים נגד חסימה</h2>
            <p className="mt-1.5 mb-4 text-[12.5px] leading-relaxed text-[var(--muted)]">
              הערוץ לא רשמי, ווואטסאפ חוסמת מספר שנראה כמו ספאם. הבלמים האלה שומרים על קצב שנראה
              אנושי.
            </p>
            {degraded && (
              <p className="mb-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                <strong>קריאת ההגדרות מהמסד נכשלה.</strong> הערכים כאן הם ברירת מחדל ולא המצב
                האמיתי. רעננו לפני ששומרים.
              </p>
            )}
            <BrakesForm
              initial={{
                whatsappPaused: settings.whatsapp_paused,
                dailyLimit: settings.daily_limit,
                minGap: settings.min_gap_seconds,
                maxGap: settings.max_gap_seconds,
                warmupEnabled: settings.warmup_enabled,
              }}
              warmupDay={warmup.day}
              warmupLimit={warmup.effectiveLimit}
              onSave={saveWhatsAppBrakesAction}
            />
          </section>

          {/* ── שרת הגשר ──────────────────────────────────────────────── */}
          <section className="card">
            <h2 className="card-title">שרת הגשר</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-2 text-[12.5px]">
              <dt className="text-[var(--muted)]">איפה</dt>
              <dd>Google Cloud · שרת חינמי</dd>
              <dt className="text-[var(--muted)]">מצב</dt>
              <dd
                className="font-medium"
                style={{ color: bridge ? "var(--ok)" : configured ? "var(--danger)" : "var(--muted)" }}
              >
                {bridge ? "פעיל · עונה" : configured ? "לא עונה" : "לא מוגדר"}
              </dd>
            </dl>
            {trialActive && (
              <p
                className="mt-3.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed"
                style={{ backgroundColor: "var(--warn-soft)" }}
              >
                <strong className="text-[var(--warn)]">
                  תקופת הניסיון בגוגל נגמרת ב-{formatDate(CLOUD_TRIAL_ENDS)}.
                </strong>{" "}
                עד אז צריך ללחוץ Upgrade בחשבון, אחרת השרת ייכבה. השרת עצמו נשאר בחינם.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** הרגע של הבקשה, מחוץ לרינדור: תחילת חלון שבעת הימים, והאם הניסיון עוד בתוקף. */
function clock() {
  const now = Date.now();
  return {
    since: new Date(now - 7 * DAY_MS).toISOString(),
    trialActive: Date.parse(CLOUD_TRIAL_ENDS) > now,
  };
}

interface RecentRow {
  id: string;
  type: "whatsapp_in" | "whatsapp_out";
  content: string | null;
  created_at: string;
  external_id: string | null;
  contact_id: string;
  contacts: { full_name: string | null; phone: string | null } | null;
}

/** "[לא נמסר: ...] [מסע] טקסט" → "טקסט". הסימונים מוצגים בנפרד, כאייקון. */
function cleanContent(content: string | null): string {
  return (content ?? "").replace(/^(\[[^\]]*\]\s*)+/, "").trim() || "—";
}

/** שעה להיום, תאריך קצר לימים קודמים. */
function shortTime(iso: string): string {
  const sameDay = formatDate(iso) === formatDate(new Date());
  return sameDay
    ? formatDateTime(iso, { hour: "2-digit", minute: "2-digit" })
    : formatDate(iso, { day: "numeric", month: "numeric" });
}

function DeliveryMark({
  failed,
  receipt,
}: {
  failed: boolean;
  receipt?: { delivered_at: string | null; opened_at: string | null };
}) {
  if (failed) {
    return (
      <span className="pill shrink-0" style={pillStyle("var(--danger)", "var(--danger-soft)")}>
        לא נמסרה
      </span>
    );
  }
  if (receipt?.opened_at) {
    return <span className="shrink-0 text-[11px] font-semibold text-[var(--nav-blue)]">נקראה ✓✓</span>;
  }
  if (receipt?.delivered_at) {
    return <span className="shrink-0 text-[11px] text-[var(--subtle)]">נמסרה ✓✓</span>;
  }
  return <span className="shrink-0 text-[11px] text-[var(--subtle)]">נשלחה ✓</span>;
}

function Metric({
  label,
  value,
  context,
  color,
}: {
  label: string;
  value: string;
  context: string;
  color?: string;
}) {
  return (
    <div className="metric" style={color ? ({ "--metric-color": color } as CSSProperties) : undefined}>
      <p className="text-[12.5px] text-[var(--muted)]">{label}</p>
      <p className="metric-value mt-2.5">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-[var(--subtle)]">{context}</p>
    </div>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "danger" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const color = tone === "danger" ? "var(--danger)" : "var(--warn)";
  return (
    <section
      className="rounded-2xl border px-[18px] py-4"
      style={{
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        backgroundColor: tone === "danger" ? "var(--danger-soft)" : "var(--warn-soft)",
      }}
    >
      <p className="text-sm font-semibold" style={{ color }}>
        {title}
      </p>
      {/* --muted ולא --subtle: על הרקעים הרכים subtle יורד מתחת לסף הקריאות. */}
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{children}</p>
    </section>
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
