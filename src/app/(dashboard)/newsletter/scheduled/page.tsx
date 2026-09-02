import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audienceLabel } from "@/lib/newsletter";
import { formatDateTime } from "@/lib/booking/timezone";
import { NEWSLETTER_STATUS_LABELS, type Newsletter } from "@/lib/supabase/database.types";
import { cancelNewsletterAction } from "../actions";

export const dynamic = "force-dynamic";

const TIMEZONE = "Asia/Jerusalem";

export default async function ScheduledPage() {
  await verifyTeamMember();

  // גם sending: ניוזלטר גדול מתפרס על כמה ריצות קרון, וכל אותו זמן מקומו
  // כאן ולא בהיסטוריה — ההתקדמות שלו היא בדיוק מה שרוצים לראות.
  const { data, error } = await supabaseAdmin()
    .from("newsletters")
    .select("*")
    .in("status", ["scheduled", "sending"])
    .order("scheduled_at");

  if (error) {
    throw new Error(
      "טבלאות הניוזלטר לא קיימות. יש להריץ את supabase/migrations/0022_newsletters.sql ב-SQL editor של Supabase."
    );
  }

  const newsletters = (data ?? []) as Newsletter[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">מתוזמנים</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מה שממתין לשליחה, ומה שנמצא באמצעה. אפשר לבטל כל עוד השליחה לא התחילה.
        </p>
      </div>

      {!newsletters.length ? (
        <div className="card text-sm text-[var(--muted)]">אין ניוזלטרים מתוזמנים.</div>
      ) : (
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">נושא</th>
                <th className="th">מועד</th>
                <th className="th">קהל</th>
                <th className="th">מצב</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {newsletters.map((newsletter) => (
                <tr
                  key={newsletter.id}
                  className="tr-hover border-b border-[var(--border)] last:border-0"
                >
                  <td className="td font-medium">{newsletter.subject}</td>
                  <td className="td whitespace-nowrap">
                    {newsletter.scheduled_at
                      ? formatDateTime(new Date(newsletter.scheduled_at), TIMEZONE)
                      : "—"}
                  </td>
                  <td className="td text-[var(--muted)]">{audienceLabel(newsletter.audience)}</td>
                  <td className="td whitespace-nowrap">
                    {NEWSLETTER_STATUS_LABELS[newsletter.status]}
                    {newsletter.status === "sending" && (
                      <span className="block text-xs text-[var(--subtle)]">
                        {newsletter.sent_count} נשלחו
                      </span>
                    )}
                  </td>
                  <td className="td text-left">
                    {newsletter.status === "scheduled" ? (
                      <form action={cancelNewsletterAction}>
                        <input type="hidden" name="id" value={newsletter.id} />
                        <button type="submit" className="btn-danger">
                          בטל
                        </button>
                      </form>
                    ) : (
                      <span className="text-xs text-[var(--subtle)]">בשליחה</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
