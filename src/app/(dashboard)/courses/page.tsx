import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertCoursesMigrated } from "@/lib/courses";
import { formatDate } from "@/lib/dates";
import type { CourseRow, CourseStage } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Counts = Record<CourseStage, number>;

/**
 * שאילתה אחת לכל ההרשמות ולא שלוש לכל קורס.
 *
 * אותו שיקול כמו ברשימת האירועים: שני שדות לכל שורת הרשמה, והספירה בזיכרון.
 */
async function countsByCourse(): Promise<Map<string, Counts>> {
  const { data, error } = await supabaseAdmin()
    .from("course_registrations")
    .select("course_id, stage");

  assertCoursesMigrated(error);
  if (error) throw error;

  const map = new Map<string, Counts>();
  for (const row of data ?? []) {
    const counts = map.get(row.course_id) ?? { interested: 0, registered: 0, paid: 0 };
    counts[row.stage] += 1;
    map.set(row.course_id, counts);
  }
  return map;
}

export default async function CoursesPage() {
  await verifyTeamMember();

  const { data, error } = await supabaseAdmin()
    .from("courses")
    .select("*")
    .order("created_at", { ascending: false });

  assertCoursesMigrated(error);
  if (error) throw error;

  const courses = (data ?? []) as CourseRow[];
  const counts = await countsByCourse();

  return (
    <div className="flex flex-col gap-6">
      <div className="h-page">
        <div>
          <h1>כל הקורסים</h1>
          <p>לכל קורס דף הרשמה משלו בכתובת ציבורית, וטופס שאפשר להטמיע בדף נחיתה קיים.</p>
        </div>
        <span className="flex-1" />
        <Link href="/courses/new" className="btn-primary">
          קורס חדש
        </Link>
      </div>

      {courses.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-[var(--muted)]">עוד אין קורסים.</p>
          <Link href="/courses/new" className="btn-secondary mt-4">
            יצירת הקורס הראשון
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {courses.map((course) => {
            const c = counts.get(course.id) ?? { interested: 0, registered: 0, paid: 0 };

            return (
              <Link
                key={course.id}
                href={`/courses/${course.id}`}
                className="card block hover:border-[var(--border-strong)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{course.name}</h2>
                      <Badge off={!course.active} label={course.active ? "פעיל" : "כבוי"} />
                      {course.legacy_webhook && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            backgroundColor: "var(--nav-blue-soft)",
                            color: "var(--nav-blue)",
                          }}
                        >
                          מחובר לדף הישן
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--muted)]">
                      <span className="slug" dir="ltr">
                        /course/{course.slug}
                      </span>
                      <span>· נוצר {formatDate(new Date(course.created_at))}</span>
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-5 text-center">
                    <Metric value={c.paid} label="לקוחות" tone="var(--primary)" />
                    <Metric value={c.registered} label="לא שילמו" tone="var(--nav-pink)" />
                    <Metric value={c.interested} label="מתעניינות" tone="var(--nav-amber)" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Badge({ off, label }: { off: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        backgroundColor: off ? "var(--nav-gray-soft)" : "var(--primary-soft)",
        color: off ? "var(--nav-gray)" : "var(--primary)",
      }}
    >
      {label}
    </span>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <p className="text-lg font-bold" style={{ color: tone }}>
        {value}
      </p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
