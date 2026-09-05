import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audienceLabel } from "@/lib/newsletter";
import { formatDateTime } from "@/lib/booking/timezone";
import type { Newsletter } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

const TIMEZONE = "Asia/Jerusalem";

export default async function HistoryPage() {
  await verifyTeamMember();

  const { data, error } = await supabaseAdmin()
    .from("newsletters")
    .select("*")
    .in("status", ["sent", "canceled"])
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    throw new Error(
      "טבלאות הניוזלטר לא קיימות. יש להריץ את supabase/migrations/0022_newsletters.sql ב-SQL editor של Supabase."
    );
  }

  const newsletters = (data ?? []) as Newsletter[];

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
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">נושא</th>
                <th className="th">מתי</th>
                <th className="th">קהל</th>
                <th className="th">נשלחו</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {newsletters.map((newsletter) => (
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
                  <td className="td text-[var(--muted)]">{audienceLabel(newsletter.audience)}</td>
                  <td className="td whitespace-nowrap tabular-nums">
                    {newsletter.sent_count}
                    {newsletter.failed_count > 0 && (
                      <span className="text-[var(--danger)]"> · {newsletter.failed_count} נכשלו</span>
                    )}
                  </td>
                  <td className="td text-left">
                    <Link href={`/newsletter?copy=${newsletter.id}`} className="btn-ghost">
                      שכפל
                    </Link>
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
