import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { readWhatsAppSettings, countWhatsAppSentToday } from "@/lib/whatsapp-throttle";
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

  return (
    <section className="card">
      <h2 className="font-medium">בלמים על השליחה האוטומטית</h2>

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
  );
}
