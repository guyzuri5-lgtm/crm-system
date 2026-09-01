import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import {
  JOURNEY_ENTRY_TYPES,
  JOURNEY_ENTRY_LABELS,
  JOURNEY_ANCHORS,
  JOURNEY_ANCHOR_LABELS,
  type Journey,
} from "@/lib/supabase/database.types";
import { createJourneyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function JourneysPage() {
  await verifyTeamMember();

  const db = supabaseAdmin();
  const [{ data: journeysRaw, error }, statuses] = await Promise.all([
    db.from("journeys").select("*").order("created_at", { ascending: false }),
    listStatuses(),
  ]);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error(
        "טבלאות המסעות לא קיימות. יש להריץ את supabase/migrations/0016_journeys.sql ב-SQL editor של Supabase."
      );
    }
    throw error;
  }

  const journeys = (journeysRaw ?? []) as Journey[];

  // ספירה לכל מסע: כמה במסע עכשיו וכמה סיימו. head:true מחזיר רק count.
  const counts = await Promise.all(
    journeys.map(async (j) => {
      const [{ count: active }, { count: total }] = await Promise.all([
        db
          .from("journey_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("journey_id", j.id)
          .eq("state", "active"),
        db
          .from("journey_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("journey_id", j.id),
      ]);
      return [j.id, { active: active ?? 0, total: total ?? 0 }] as const;
    })
  );
  const countById = new Map(counts);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">מסע לקוח</h1>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          רצף שלבים שאיש קשר עובר לאורך זמן. בניגוד לכלל אוטומציה, שהוא חד-שלבי וחסר
          זיכרון, מסע זוכר איפה כל אדם עומד וממשיך משם.{" "}
          <strong>היחידה הקטנה ביותר היא יום</strong> — הקרון רץ פעם ביום.
        </p>
      </div>

      <section className="card">
        <h2 className="mb-4 font-medium">מסע חדש</h2>
        <form action={createJourneyAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            שם המסע
            <input name="name" required className="input" placeholder="מעקב אחרי ליד חדש" />
          </label>

          <label className="field-label">
            מה מכניס למסע
            <select name="entry_type" className="input" required defaultValue="status">
              {JOURNEY_ENTRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {JOURNEY_ENTRY_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            הסטטוס (רק כשהכניסה לפי סטטוס)
            <select name="status" className="input" defaultValue="">
              <option value="">—</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            תזמון השלבים
            <select name="anchor" className="input" defaultValue="enrollment">
              {JOURNEY_ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {JOURNEY_ANCHOR_LABELS[a]}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-[var(--subtle)]">
              &quot;יחסית למועד הפגישה&quot; מאפשר לשלוח <strong>לפני</strong> הפגישה, ודורש
              שהכניסה תהיה &quot;קבע פגישה&quot;.
            </span>
          </label>

          <label className="field-label">
            תיאור (לא חובה)
            <input name="description" className="input" />
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-2">
            צור מסע
          </button>
        </form>
        <p className="mt-3 text-xs leading-relaxed text-[var(--subtle)]">
          המסע נוצר כבוי. מוסיפים לו שלבים ורק אז מדליקים — מסע שנדלק באמצע עריכה
          שולח הודעות אמיתיות, ואי אפשר לבטל אותן.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        {journeys.map((j) => {
          const c = countById.get(j.id);
          return (
            <Link key={j.id} href={`/journeys/${j.id}`} className="card hover:border-[var(--primary)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{j.name}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                      j.active
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                        : "bg-stone-100 text-stone-600 ring-stone-500/15"
                    }`}
                  >
                    {j.active ? "פעיל" : "כבוי"}
                  </span>
                </div>
                <span className="text-xs text-[var(--subtle)]">
                  {JOURNEY_ENTRY_LABELS[j.entry_type]}
                  {j.entry_type === "status" && j.entry_value?.status
                    ? `: ${j.entry_value.status}`
                    : ""}
                </span>
              </div>
              {j.description && (
                <p className="mt-1 text-sm text-[var(--muted)]">{j.description}</p>
              )}
              <p className="mt-2 text-xs text-[var(--subtle)]">
                {c?.active ?? 0} במסע כרגע · {c?.total ?? 0} נכנסו בסך הכול
              </p>
            </Link>
          );
        })}
        {!journeys.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין מסעות</p>
        )}
      </section>
    </div>
  );
}
