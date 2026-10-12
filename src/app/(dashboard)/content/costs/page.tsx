import { verifyTeamMember } from "@/lib/dal";
import { listBrollCosts, type BrollCost } from "@/lib/content/broll-costs";
import { formatDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * כמה עלה לייצר את הבירולים של כל סרטון.
 *
 * כל שורה נכתבת לבד בסוף העריכה באפטר (talking-head-to-ae → report_cost.py).
 * עלות ה-AI היא מה ש-fal גובה על התמונות והסרטונים; עלות קלוד היא הטוקנים של
 * שיחת העריכה לפי מחירון ה-API — אומדן, כי במנוי אין חשבון לכל שיחה.
 */
export default async function ContentCostsPage() {
  await verifyTeamMember();

  let rows: BrollCost[];
  try {
    rows = await listBrollCosts();
  } catch {
    throw new Error("לא הצלחנו לקרוא את טבלת העלויות. אם זה חוזר, ייתכן שמיגרציה 0049_broll_costs.sql לא רצה במסד.");
  }

  const usd = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
  const total = (r: BrollCost) => r.ai_usd + (r.claude_usd ?? 0);
  const sum = (f: (r: BrollCost) => number) => rows.reduce((s, r) => s + f(r), 0);
  const sums = {
    brolls: sum((r) => r.ai_brolls),
    videos: sum((r) => r.ai_videos),
    images: sum((r) => r.ai_images),
    seconds: sum((r) => r.ai_seconds),
    ai: sum((r) => r.ai_usd),
    claude: sum((r) => r.claude_usd ?? 0),
    total: sum(total),
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-7 lg:px-7">
      <div>
        <h1 className="page-title">עלויות בירולים</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          שורה לכל סרטון שנערך באפטר, שנוספת לבד בסוף העריכה. עלות AI היא יצירת התמונות והסרטונים; עלות קלוד היא
          שיחת העריכה לפי מחירון ה-API (אומדן).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-[var(--muted)]">
          עוד אין סרטונים בטבלה. השורה הראשונה תופיע כשהעריכה הבאה באפטר תסתיים.
        </div>
      ) : (
        <>
          <div className="card text-sm">
            <span className="font-medium tabular-nums">{rows.length}</span> סרטונים, סה&quot;כ{" "}
            <span className="font-medium tabular-nums">{usd(sums.total)}</span>.{" "}
            <span className="text-[var(--muted)]">
              ממוצע לסרטון <span className="tabular-nums">{usd(sums.total / rows.length)}</span>.
            </span>
          </div>

          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="th">מס׳</th>
                  <th className="th">סרטון</th>
                  <th className="th">נערך</th>
                  <th className="th">בירולי AI</th>
                  <th className="th">סרטונים</th>
                  <th className="th">תמונות</th>
                  <th className="th">שניות</th>
                  <th className="th">עלות AI</th>
                  <th className="th">עלות קלוד</th>
                  <th className="th">סה&quot;כ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.video_folder} className="border-b border-[var(--border)] last:border-0">
                    <td className="td tabular-nums">{r.piece_no ?? "—"}</td>
                    <td className="td font-medium">{r.title}</td>
                    <td className="td whitespace-nowrap text-[var(--muted)]">{formatDate(r.edited_at)}</td>
                    <td className="td tabular-nums">{r.ai_brolls}</td>
                    <td className="td tabular-nums">{r.ai_videos}</td>
                    <td className="td tabular-nums">{r.ai_images}</td>
                    <td className="td tabular-nums">{Math.round(r.ai_seconds)}</td>
                    <td className="td tabular-nums">{usd(r.ai_usd)}</td>
                    <td className="td tabular-nums">{usd(r.claude_usd)}</td>
                    <td className="td font-medium tabular-nums">{usd(total(r))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--border)]">
                  <td className="td" />
                  <td className="td font-medium">סה&quot;כ</td>
                  <td className="td" />
                  <td className="td font-medium tabular-nums">{sums.brolls}</td>
                  <td className="td font-medium tabular-nums">{sums.videos}</td>
                  <td className="td font-medium tabular-nums">{sums.images}</td>
                  <td className="td font-medium tabular-nums">{Math.round(sums.seconds)}</td>
                  <td className="td font-medium tabular-nums">{usd(sums.ai)}</td>
                  <td className="td font-medium tabular-nums">{usd(sums.claude)}</td>
                  <td className="td font-medium tabular-nums">{usd(sums.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
