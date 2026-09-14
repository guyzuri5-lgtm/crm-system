import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// משפך שאלון הצ'אקרות.
//
// עד היום היה אפשר לראות רק את מי שסיים את השאלון, כי רשומה ב-
// quiz_submissions נוצרת רק בסוף. כלומר המספר "מילאו את השאלון" תמיד היה
// 100% מעצמו, וכל הנשירה — שהיא העיקר — הייתה בלתי נראית.
//
// quiz_progress נוצרת לכל מי שנחת על הדף, ולכן כאן אפשר סוף סוף לראות
// כמה נכנסו, כמה בכלל התחילו, ואיפה בדיוק אנשים עוזבים.

type ProgressRow = {
  session_id: string;
  reached_step: number;
  total_steps: number;
  reached_label: string | null;
  completed: boolean;
  first_seen_at: string;
};

/** כמה הגיעו לכל צעד. צעד n נספר לכל מי שהגיע אליו או רחוק ממנו. */
function reachedByStep(rows: ProgressRow[], total: number) {
  const out: { step: number; label: string; reached: number }[] = [];
  // התווית נלקחת ממי שעצר בדיוק שם; אם אף אחד לא עצר שם, נופלים למספר
  const labelAt = new Map<number, string>();
  for (const r of rows) {
    if (r.reached_label && !labelAt.has(r.reached_step)) {
      labelAt.set(r.reached_step, r.reached_label);
    }
  }
  for (let step = 1; step <= total; step++) {
    out.push({
      step,
      label: labelAt.get(step) ?? `צעד ${step}`,
      reached: rows.filter((r) => r.reached_step >= step).length,
    });
  }
  return out;
}

export default async function QuizFunnelPage() {
  await verifyTeamMember();
  const db = supabaseAdmin();

  const [{ data: progress, error: progressErr }, { data: subs }] = await Promise.all([
    db
      .from("quiz_progress")
      .select("session_id, reached_step, total_steps, reached_label, completed, first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(5000),
    db.from("quiz_submissions").select("kind, booking_clicked_at"),
  ]);

  // PGRST205 = הטבלה לא קיימת. המיגרציה 0040 היא תנאי לדף הזה, אבל אין
  // סיבה שדף שלם ייפול בגללה — מציגים הסבר במקום מסך שגיאה.
  if (progressErr && progressErr.code === "PGRST205") {
    return (
      <div className="card p-6">
        <h1 className="mb-2 text-lg font-bold">משפך השאלון</h1>
        <p className="text-[var(--muted)]">
          הטבלה <code>quiz_progress</code> עוד לא קיימת. הריצו את
          <code className="mx-1">supabase/migrations/0040_quiz_progress.sql</code>
          ב-SQL Editor, והנתונים יתחילו להצטבר מהמילוי הבא.
        </p>
      </div>
    );
  }
  if (progressErr) throw progressErr;

  const rows = (progress ?? []) as ProgressRow[];
  const landed = rows.length;
  const started = rows.filter((r) => r.reached_step >= 1).length;
  const finished = rows.filter((r) => r.completed).length;

  const leads = (subs ?? []).filter((s) => s.kind === "lead" || s.kind === "booking_click").length;
  const booked = (subs ?? []).filter((s) => s.booking_clicked_at).length;

  // אורך המסלול משתנה בין גרסאות של השאלון; לוקחים את הנפוץ ביותר
  const totalSteps = rows.length
    ? [...rows.reduce((m, r) => m.set(r.total_steps, (m.get(r.total_steps) ?? 0) + 1), new Map<number, number>())]
        .sort((a, b) => b[1] - a[1])[0][0]
    : 0;

  const steps = reachedByStep(rows, totalSteps);
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

  const cards = [
    { label: "נחתו על הדף", value: landed, sub: "כולל מי שלא התחיל" },
    { label: "התחילו לענות", value: started, sub: `${pct(started, landed)}% מהנוחתים` },
    { label: "סיימו את השאלון", value: finished, sub: `${pct(finished, started)}% מהמתחילים` },
    { label: "השאירו פרטים", value: leads, sub: `${pct(leads, finished)}% מהמסיימים` },
    { label: "יצאו לקבוע פגישה", value: booked, sub: `${pct(booked, finished)}% מהמסיימים` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">משפך השאלון</h1>
        <p className="text-sm text-[var(--muted)]">
          איפה אנשים עוזבים את שאלון הצ&apos;אקרות, ובאיזה שלב בדיוק.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card p-3">
            <b className="block text-2xl font-extrabold leading-none">{c.value}</b>
            <span className="mt-1 block text-xs font-semibold">{c.label}</span>
            <span className="block text-[11px] text-[var(--subtle)]">{c.sub}</span>
          </div>
        ))}
      </div>

      {landed === 0 ? (
        <div className="card p-6 text-sm text-[var(--muted)]">
          עוד לא נאספו נתונים. הם יתחילו להצטבר מהמילוי הבא אחרי שהגרסה
          החדשה של <code>index.html</code> עלתה לאוויר.
        </div>
      ) : (
        <div className="card p-4">
          <h2 className="mb-1 text-sm font-bold">כמה הגיעו לכל שלב</h2>
          <p className="mb-3 text-xs text-[var(--muted)]">
            העמודה &quot;נשרו כאן&quot; היא מי שהשלב הזה היה הרחוק ביותר שהגיע אליו.
            שם כדאי להסתכל כשמחפשים מה לתקן.
          </p>
          <div className="table-wrap">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th text-start">שלב</th>
                  <th className="th text-start">הגיעו</th>
                  <th className="th text-start">מהמתחילים</th>
                  <th className="th text-start">נשרו כאן</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s, i) => {
                  const next = steps[i + 1];
                  const dropped = next ? s.reached - next.reached : 0;
                  const dropPct = s.reached > 0 ? Math.round((dropped / s.reached) * 100) : 0;
                  // נשירה חריגה בשלב בודד היא בדיוק מה שהדף הזה נועד למצוא
                  const heavy = dropPct >= 15;
                  return (
                    <tr key={s.step}>
                      <td className="td">
                        <span className="text-[var(--subtle)]">{s.step}.</span> {s.label}
                      </td>
                      <td className="td tabular-nums font-bold">{s.reached}</td>
                      <td className="td tabular-nums">{pct(s.reached, started)}%</td>
                      <td className="td tabular-nums">
                        {dropped > 0 ? (
                          <span className={heavy ? "font-bold text-[var(--danger)]" : ""}>
                            −{dropped} ({dropPct}%)
                          </span>
                        ) : (
                          <span className="text-[var(--subtle)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
