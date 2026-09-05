import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertCoursesMigrated, countCourseStages, getCourseById } from "@/lib/courses";
import { formatDateTime } from "@/lib/dates";
import {
  COURSE_SOURCE_LABELS,
  COURSE_STAGE_LABELS,
  type Contact,
  type CourseStage,
  type CourseSource,
} from "@/lib/supabase/database.types";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "../../booking/copy-link";
import { CopyEmbed } from "@/components/copy-embed";
import { markCoursePaidAction, toggleCourseActiveAction } from "../actions";

export const dynamic = "force-dynamic";

type RegistrationRow = {
  id: string;
  stage: CourseStage;
  source: CourseSource;
  created_at: string;
  paid_at: string | null;
  contacts: Contact | null;
};

/** תג צבעוני לכל שלב, באותה שפה ויזואלית של תגי הסטטוס במערכת. */
const STAGE_TONE: Record<CourseStage, { bg: string; text: string }> = {
  paid: { bg: "var(--primary-soft)", text: "var(--primary)" },
  interested: { bg: "var(--nav-amber-soft)", text: "var(--nav-amber)" },
  registered: { bg: "var(--nav-pink-soft)", text: "var(--nav-pink)" },
};

export default async function CourseManagePage({ params }: PageProps<"/courses/[id]">) {
  await verifyTeamMember();
  const { id } = await params;

  const course = await getCourseById(id);
  if (!course) notFound();

  const [counts, { data, error }] = await Promise.all([
    countCourseStages(course.id),
    supabaseAdmin()
      .from("course_registrations")
      .select("id, stage, source, created_at, paid_at, contacts(*)")
      .eq("course_id", course.id)
      .order("created_at", { ascending: false })
      .returns<RegistrationRow[]>(),
  ]);

  assertCoursesMigrated(error);
  if (error) throw error;

  const registrations = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{course.name}</h1>
          <p className="mt-1.5">
            <span className="slug" dir="ltr">
              /course/{course.slug}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <CopyLink path={`/course/${course.slug}`} label="העתקת לינק ישיר" />
          <CopyEmbed slug={course.slug} fieldCount={course.custom_fields.length} kind="course" />
          <Link href={`/courses/${course.id}/edit`} className="btn-secondary">
            עיצוב הדף
          </Link>
          {/* פותח יצירת מסע עם הטריגר "נרשמה כמתעניינת לקורס" מסומן מראש */}
          <Link href={`/journeys?course=${course.id}`} className="btn-primary">
            מסע למתעניינות
          </Link>
        </div>
      </div>

      {!course.active && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--nav-amber)]">
          <p className="text-sm">
            <span className="font-semibold text-[var(--nav-amber)]">הקורס כבוי.</span>{" "}
            <span className="text-[var(--muted)]">
              דף ההרשמה הציבורי מחזיר &quot;לא נמצא&quot;, וטופס מוטמע מפסיק להופיע.
            </span>
          </p>
          <ActionForm action={toggleCourseActiveAction}>
            <input type="hidden" name="id" value={course.id} />
            <input type="hidden" name="active" value="true" />
            <button type="submit" className="btn-secondary">
              הפעלה מחדש
            </button>
          </ActionForm>
        </div>
      )}

      {/* משפך ולא שלושה כרטיסים: ההפרש בין השלבים הוא מה שמעניין בקורס,
          לא הערך המוחלט של כל אחד מהם. */}
      <section className="card flex flex-col gap-2.5">
        <FunnelRow label="מתעניינות" value={counts.interested} max={counts.interested} tone="var(--nav-amber)" />
        <FunnelRow
          label="התחילו"
          value={counts.registered + counts.paid}
          max={counts.interested}
          tone="var(--nav-pink)"
        />
        <FunnelRow label="שילמו" value={counts.paid} max={counts.interested} tone="var(--primary)" />
      </section>

      {registrations.length === 0 ? (
        <div className="card text-center text-sm text-[var(--muted)]">
          עוד אף אחת לא נרשמה. הקישור לדף ההרשמה וקוד ההטמעה מוכנים להעתקה למעלה.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">שם</th>
                <th className="th">טלפון</th>
                <th className="th">אימייל</th>
                <th className="th">שלב</th>
                <th className="th">מקור</th>
                <th className="th">נרשמה</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((row) => (
                <tr key={row.id} className="tr-hover border-b border-[var(--border)] last:border-0">
                  <td className="td font-medium">
                    {row.contacts ? (
                      <Link href={`/contacts/${row.contacts.id}`} className="hover:underline">
                        {row.contacts.full_name ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="td" dir="ltr">
                    {row.contacts?.phone ?? "—"}
                  </td>
                  <td className="td" dir="ltr">
                    {row.contacts?.email ?? "—"}
                  </td>
                  <td className="td">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: STAGE_TONE[row.stage].bg,
                        color: STAGE_TONE[row.stage].text,
                      }}
                    >
                      {COURSE_STAGE_LABELS[row.stage]}
                    </span>
                  </td>
                  <td className="td text-[var(--muted)]">{COURSE_SOURCE_LABELS[row.source]}</td>
                  <td className="td text-[var(--muted)]">{formatDateTime(row.created_at)}</td>
                  <td className="td text-end">
                    {row.stage !== "paid" && (
                      // הגיבוי לגרואו: כל עוד אין webhook, זו הדרך לסגור את
                      // המעגל אחרי שרואים תשלום בפועל.
                      <ActionForm action={markCoursePaidAction}>
                        <input type="hidden" name="registration_id" value={row.id} />
                        <input type="hidden" name="course_id" value={course.id} />
                        <button type="submit" className="btn-ghost whitespace-nowrap">
                          סימון כשילמה
                        </button>
                      </ActionForm>
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

/** שורת משפך. הבסיס הוא תמיד השלב הרחב ביותר, אחרת הפסים לא ניתנים להשוואה. */
function FunnelRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="fn-row">
      <span className="fn-label">{label}</span>
      <span className="fn-track">
        <i style={{ width: `${pct}%`, backgroundColor: tone }} />
      </span>
      <span className="fn-value">{value}</span>
    </div>
  );
}
