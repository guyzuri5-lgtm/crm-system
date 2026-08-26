import { verifyTeamMember } from "@/lib/dal";
import { getWhatsAppSettings, countWhatsAppSentToday } from "@/lib/whatsapp-throttle";
import { isWhatsAppConfigured, getPhoneNumberStatus } from "@/lib/whatsapp-cloud";
import { saveWhatsAppSettingsAction } from "./actions";

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
      <div>
        <h1 className="text-xl font-semibold">וואטסאפ</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מצב המספר אצל Meta ובלמי השליחה האוטומטית. ההגדרות כאן חלות על הקרון היומי
          בלבד — שליחה ידנית מכרטיס לקוח לא נחסמת, אבל כן נספרת בתקרה.
        </p>
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
                className={`mt-1 font-medium ${
                  quality.tone === "ok"
                    ? "text-emerald-600"
                    : quality.tone === "warn"
                      ? "text-amber-600"
                      : "text-[var(--danger)]"
                }`}
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
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {sentToday ?? "—"}
            <span className="text-base font-normal text-[var(--subtle)]">
              {" "}
              / {settings.daily_limit}
            </span>
          </p>
          {phone?.displayPhoneNumber && (
            <p className="mt-1 text-xs text-[var(--subtle)]" dir="ltr">
              {phone.displayPhoneNumber}
            </p>
          )}
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
        <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--muted)]">
          בניגוד לערוץ הלא רשמי, כאן אין סיכון שהמספר ייחסם — Cloud API הוא הערוץ
          המאושר של Meta. התקרה כאן היא בלם <strong>עלות</strong>: כל תבנית שנמסרת
          מחויבת, ולולאה שהשתבשה היא חשבונית.
        </p>

        <form action={saveWhatsAppSettingsAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            תקרת תבניות יומית
            <input
              name="daily_limit"
              type="number"
              min={1}
              max={5000}
              required
              defaultValue={settings.daily_limit}
              className="input"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              נספרות כל ההודעות היוצאות, כולל ידניות. הודעות בתוך חלון 24 השעות אינן
              עולות כסף, אבל כן נספרות כאן.
            </span>
          </label>

          <label className="flex items-start gap-2.5 self-start text-sm font-medium">
            <input
              type="checkbox"
              name="paused"
              defaultChecked={settings.paused}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              השהיית השליחה האוטומטית
              <span className="mt-0.5 block text-xs font-normal text-[var(--subtle)]">
                עוצר את הקרון היומי מיד, בלי deploy ובלי לגעת בכללי האוטומציה. שליחה
                ידנית מכרטיס לקוח ממשיכה לעבוד.
              </span>
            </span>
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-2">
            שמירת הגדרות
          </button>
        </form>
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
                <td className="td font-medium text-emerald-600">חלון פתוח</td>
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
