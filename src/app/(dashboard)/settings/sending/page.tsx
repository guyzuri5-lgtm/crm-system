import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { readWhatsAppSettings, countWhatsAppSentToday } from "@/lib/whatsapp-throttle";
import { readCronHealth } from "@/lib/cron-health";
import { saveWhatsAppSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SendingSettingsPage() {
  await verifyTeamMember();

  // readWhatsAppSettings ולא getWhatsAppSettings: המסך הזה חייב להבדיל בין
  // הערכים השמורים לבין ברירות מחדל שהוחזרו אחרי קריאה שנכשלה. הצגת פולבק
  // כאילו הוא האמת היא בדיוק איך שהמסך הראה "לא מושהה" בזמן שהשליחה עצורה.
  const { settings, degraded } = await readWhatsAppSettings();
  // כישלון בספירה אינו סיבה להפיל את הדף — זה גם הדף שבו משהים שליחה כשמשהו
  // משתבש, וחסימת הגישה אליו בדיוק אז היא התנהגות גרועה.
  const sentToday = await countWhatsAppSentToday().catch(() => null);
  // readCronHealth לא זורקת לעולם — ר' ההערה עליה. המסך הזה הוא בין היתר
  // המסך שפותחים כשמשהו לא נשלח, וכישלון שלו דווקא אז הוא התנהגות גרועה.
  const cron = await readCronHealth();

  return (
    <>
      <SchedulerPanel cron={cron} />

      <section className="card">
        <h2 className="card-title">בלמים על השליחה האוטומטית</h2>

        {degraded && (
          <p className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            <strong>קריאת ההגדרות מהמסד נכשלה.</strong> מה שמוצג למטה הוא ברירת מחדל ולא
            המצב האמיתי — ייתכן שהשליחה מושהית גם אם התיבה נראית ריקה. רעננו את הדף לפני
            שמסתמכים על מה שכתוב כאן, ואל תשמרו בינתיים: שמירה תדרוס את הערכים השמורים
            בברירות המחדל האלה.
          </p>
        )}
        <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--muted)]">
          בניגוד לערוץ הלא רשמי, כאן אין סיכון שהמספר ייחסם — Cloud API הוא הערוץ המאושר
          של Meta. התקרה כאן היא בלם <strong>עלות</strong>: כל תבנית שנמסרת מחויבת, ולולאה
          שהשתבשה היא חשבונית.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">
          ההגדרות חלות על הקרון היומי בלבד. שליחה ידנית מכרטיס לקוח לא נחסמת, אבל כן נספרת
          בתקרה.
          {sentToday !== null && (
            <>
              {" "}
              נשלחו היום <strong>{sentToday}</strong> מתוך {settings.daily_limit}.
            </>
          )}
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
              נספרות כל ההודעות היוצאות, כולל ידניות. הודעות בתוך חלון 24 השעות אינן עולות
              כסף, אבל כן נספרות כאן.
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
                עוצר את הקרון היומי מיד, בלי deploy ובלי לגעת בכללי האוטומציה. שליחה ידנית
                מכרטיס לקוח ממשיכה לעבוד.
              </span>
            </span>
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-2">
            שמירת הגדרות
          </button>
        </form>

        <p className="mt-4 text-sm text-[var(--muted)]">
          את מצב המספר אצל Meta ואת דירוג האיכות שלו רואים בעמוד{" "}
          <Link href="/whatsapp" className="underline">
            וואטסאפ
          </Link>
          .
        </p>
      </section>
    </>
  );
}


/**
 * מצב המתזמן.
 *
 * ── למה זה יושב דווקא כאן ──
 * המסך הזה כבר אומר "ההגדרות חלות על הקרון". עד עכשיו הוא הציג את שני
 * הבלמים שעוצרים אותו, ושתק לגמרי על השאלה שקודמת להם — האם הוא בכלל רץ.
 * ב-25.9.2026 זו הייתה השאלה היחידה שחשבה, ולא היה במערכת מסך אחד שיכול
 * היה לענות עליה.
 *
 * ── למה ירוק אינו ברירת המחדל ──
 * אותו לקח מ-4683d9c: היעדר נתונים אינו תקינות. כל עוד אין חותמת סיום
 * במסד, הכרטיס אומר "אין נתונים" — לא "תקין".
 */
function SchedulerPanel({ cron }: { cron: Awaited<ReturnType<typeof readCronHealth>> }) {
  const bad = cron.state === "stale" || cron.state === "failing" || cron.state === "interrupted";
  const warn = cron.state === "late" || cron.state === "unknown";

  const headline =
    cron.state === "ok"
      ? "המתזמן רץ כסדרו"
      : cron.state === "late"
        ? "המתזמן מאחר"
        : cron.state === "stale"
          ? "המתזמן אינו רץ"
          : cron.state === "failing"
            ? "הריצה האחרונה של המתזמן נפלה"
            : cron.state === "interrupted"
              ? "הריצה האחרונה נקטעה באמצע"
              : "אין נתונים על המתזמן";

  const tone = bad ? "var(--danger)" : warn ? "var(--warn)" : "var(--ok)";
  const soft = bad ? "var(--danger-soft)" : warn ? "var(--warn-soft)" : "var(--ok-soft)";

  return (
    <section className="card mb-3">
      <h2 className="card-title">המתזמן</h2>

      <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: soft, color: tone }}>
        <strong>{headline}.</strong>{" "}
        {cron.missing ? (
          <>
            הטבלה שרושמת את הריצות אינה קיימת. יש להריץ את{" "}
            {/* dir="ltr" חובה: בלעדיו הדפדפן מסדר את קטעי השם מימין לשמאל,
                והוא מוצג כ-"cron_heartbeat.sql_0042". נמדד בפועל, ואותה
                מלכודת בדיוק עוטפת את מספר הטלפון בדף הבית. */}
            <span className="data" dir="ltr">
              supabase/migrations/0042_cron_heartbeat.sql
            </span>{" "}
            ב-SQL editor של Supabase.
          </>
        ) : cron.lastFinishedAt ? (
          <>
            הריצה האחרונה הסתיימה לפני {cron.minutesSince} דק׳.
            {cron.error && <> הסיבה שנרשמה: {cron.error}</>}
          </>
        ) : (
          <>מאז שהמחוון נוצר לא נרשמה אף ריצה שהסתיימה.</>
        )}
      </p>

      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        המתזמן מפעיל את המסעות, הניוזלטר, כללי האוטומציה ותזכורות הפגישות. הוא{" "}
        <strong>אינו</strong> אחראי עוד על מסירת קורס או אירוע ששולם עליו — תשלום שולח מיד,
        ללא תלות בו. תזכורת שמעוגנת לשעת פגישה היא הדבר הרגיש ביותר שכן תלוי בו: מתזמן
        שישן שעה שולח אותה באיחור של שעה, או אחרי שהפגישה כבר עברה.
      </p>
    </section>
  );
}
