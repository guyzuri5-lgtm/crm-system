import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audienceLabel } from "@/lib/newsletter";
import { formatDateTime } from "@/lib/booking/timezone";
import type { Newsletter, NewsletterStats } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const TIMEZONE = "Asia/Jerusalem";

/**
 * אחוז מתוך מה שנשלח, או null כשאין ממה לחשב.
 *
 * המכנה הוא sent ולא delivered בכוונה: את מספר השליחות אנחנו יודעים בוודאות
 * מהמסד, ואילו "נמסר" תלוי ב-webhook נפרד שאולי לא הוגדר. אחוז שמחושב על
 * מכנה חסר גדול מ-100 ונראה כמו באג.
 */
function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/**
 * אחוז, ולצידו המספר שממנו הוא נגזר.
 *
 * ── שתי החלטות שאינן קוסמטיות ──
 * flex ולא שני אלמנטים זה אחרי זה: בעברית, "41%" ו-"247" הם שני רצפי ספרות
 * צמודים, והאלגוריתם הדו-כיווני מאחד אותם לרצף אחד משמאל לימין — "41%247",
 * בלי רווח ובלי סדר שאפשר לסמוך עליו. פריטי flex אינם מסודרים מחדש כך.
 *
 * measurable=0 מקבל מקף ולא 0%: דיוור שיצא לפני שהמדידה נוספה אינו דיוור
 * שאיש לא פתח. אפס במקום הזה נראה ככישלון, והוא רק היעדר נתון.
 */
function RateCell({
  part,
  whole,
  measurable,
  color,
}: {
  part: number;
  whole: number;
  measurable: number;
  color: string;
}) {
  if (measurable === 0) {
    return (
      <span className="text-[var(--subtle)]" title="הדיוור יצא לפני שהמדידה נוספה">
        —
      </span>
    );
  }

  const pct = rate(part, whole);
  if (pct === null) return <span className="text-[var(--subtle)]">—</span>;

  return (
    <span className="flex items-baseline gap-1.5">
      <b className="font-semibold" style={{ color: part > 0 ? color : "var(--subtle)" }}>
        {pct}%
      </b>
      <span className="text-[11px] text-[var(--subtle)]">{part}</span>
    </span>
  );
}

export default async function HistoryPage() {
  await verifyTeamMember();

  const db = supabaseAdmin();

  const [{ data, error }, statsRes] = await Promise.all([
    db
      .from("newsletters")
      .select("*")
      .in("status", ["sent", "canceled"])
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(100),
    // התצוגה נוצרת ב-0038. עד שהמיגרציה תרוץ השאילתה מחזירה שגיאה, והמסך
    // ימשיך לעבוד בלי עמודות הפתיחה — היסטוריית דיוור חשובה יותר ממדידה.
    db.from("newsletter_stats").select("*"),
  ]);

  if (error) {
    throw new Error(
      "טבלאות הניוזלטר לא קיימות. יש להריץ את supabase/migrations/0022_newsletters.sql ב-SQL editor של Supabase."
    );
  }

  const newsletters = (data ?? []) as Newsletter[];
  const statsById = new Map(
    ((statsRes.data ?? []) as NewsletterStats[]).map((row) => [row.newsletter_id, row])
  );
  // המדידה נוספה ב-0037, ודיוורים שיצאו לפניה לא נמדדו כלל. בלי ההבחנה הזו
  // הם היו מוצגים כ-0% פתיחה, כלומר ככישלון — במקום כ"לא נמדד".
  const tracking = statsRes.error === null;
  const measured = newsletters.some((n) => (statsById.get(n.id)?.measurable ?? 0) > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">היסטוריה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מה שכבר יצא. &rdquo;שכפל&rdquo; פותח הודעה חדשה עם אותו תוכן — הישנה נשארת כפי שנשלחה.
        </p>
      </div>

      {!newsletters.length ? (
        <div className="card text-sm text-[var(--muted)]">עוד לא נשלח אף ניוזלטר.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="th">נושא</th>
                  <th className="th">מתי</th>
                  <th className="th">קהל</th>
                  <th className="th">נשלחו</th>
                  {tracking && <th className="th">נפתחו</th>}
                  {tracking && <th className="th">נלחצו</th>}
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {newsletters.map((newsletter) => {
                  const stats = statsById.get(newsletter.id);
                  return (
                    <tr
                      key={newsletter.id}
                      className="tr-hover border-b border-[var(--border)] last:border-0"
                    >
                      <td className="td font-medium">
                        {newsletter.subject}
                        {newsletter.status === "canceled" && (
                          <span className="mr-2 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                            בוטל
                          </span>
                        )}
                      </td>
                      <td className="td whitespace-nowrap">
                        {newsletter.scheduled_at
                          ? formatDateTime(new Date(newsletter.scheduled_at), TIMEZONE)
                          : "—"}
                      </td>
                      <td className="td text-[var(--muted)]">
                        {audienceLabel(newsletter.audience)}
                      </td>
                      <td className="td whitespace-nowrap tabular-nums">
                        {newsletter.sent_count}
                        {newsletter.failed_count > 0 && (
                          <span className="text-[var(--danger)]">
                            {" "}
                            · {newsletter.failed_count} נכשלו
                          </span>
                        )}
                      </td>
                      {tracking && (
                        <td className="td whitespace-nowrap tabular-nums">
                          <RateCell
                            part={stats?.opened ?? 0}
                            whole={newsletter.sent_count}
                            measurable={stats?.measurable ?? 0}
                            color="var(--nav-coral)"
                          />
                        </td>
                      )}
                      {tracking && (
                        <td className="td whitespace-nowrap tabular-nums">
                          <RateCell
                            part={stats?.clicked ?? 0}
                            whole={newsletter.sent_count}
                            measurable={stats?.measurable ?? 0}
                            color="var(--primary)"
                          />
                        </td>
                      )}
                      <td className="td text-left">
                        <Link href={`/newsletter?copy=${newsletter.id}`} className="btn-ghost">
                          שכפל
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {tracking && (
            <div className="card text-[13px] leading-relaxed text-[var(--muted)]">
              {measured ? (
                <>
                  <b className="font-semibold text-[var(--fg)]">איך לקרוא את המספרים.</b>{" "}
                  <b className="font-semibold">נלחצו</b> הוא המדד האמין — הוא מודד מה אנשים עשו.{" "}
                  <b className="font-semibold">נפתחו</b> שווה כהשוואה בין דיוורים ולא כמספר
                  מוחלט: אפל פותחת אוטומטית כל מייל של מי שקורא ב-Mail באייפון, ולעומת זאת מי
                  שחוסם תמונות אינו נספר כלל. שני העיוותים פועלים בכיוונים הפוכים, ואי אפשר
                  לדעת מה נשאר.
                </>
              ) : (
                <>
                  <b className="font-semibold text-[var(--fg)]">עוד אין נתוני פתיחה.</b> המדידה
                  מתחילה מהדיוור הבא, ורק אחרי שה-webhook הוגדר ב-Postmark (ראו README, פרק
                  המייל). דיוורים שיצאו לפני כן יישארו ריקים — הם לא נמדדו, וזה לא אומר שאיש
                  לא פתח אותם.
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
