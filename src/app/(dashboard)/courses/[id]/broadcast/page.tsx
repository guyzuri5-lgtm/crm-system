import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCourseById } from "@/lib/courses";
import { countByStage, listCourseAudience, usableForCourse } from "@/lib/course-broadcast";
import { formatDateTime } from "@/lib/dates";
import { SendingPausedNotice } from "@/components/sending-paused-notice";
import {
  COURSE_STAGE_LABELS,
  type CourseBroadcast,
  type CourseStage,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import { BroadcastCompose } from "./compose";

export const dynamic = "force-dynamic";

type BroadcastRow = CourseBroadcast & { message_templates: { name: string } | null };

export default async function CourseBroadcastPage({
  params,
}: PageProps<"/courses/[id]/broadcast">) {
  await verifyTeamMember();
  const { id } = await params;

  const course = await getCourseById(id);
  if (!course) notFound();

  const db = supabaseAdmin();
  const [audience, { data: templatesRaw }, { data: historyRaw, error: historyError }] =
    await Promise.all([
      listCourseAudience(course.id),
      db.from("message_templates").select("*").eq("channel", "whatsapp"),
      // maybe: הטבלה נוספה ב-0032, והמסך חייב להיפתח גם לפני שהמיגרציה רצה
      // — אחרת אי אפשר להגיע אליו כדי לראות את ההסבר איך להריץ אותה.
      db
        .from("course_broadcasts")
        .select("*, message_templates(name)")
        .eq("course_id", course.id)
        .order("created_at", { ascending: false })
        .limit(20)
        .returns<BroadcastRow[]>(),
    ]);

  const counts = countByStage(audience);

  // רק תבניות שמטא אישרה מוצעות: רק הן יכולות לצאת מחוץ לחלון 24 השעות,
  // ושם נמצאים כמעט כל הנרשמים. אותו סינון בדיוק כמו בתזכורות האירועים.
  const templates = ((templatesRaw ?? []) as MessageTemplate[]).filter(
    (t) =>
      Boolean(t.meta_template_name) && t.meta_status === "APPROVED" && usableForCourse(t)
  );

  const migrationMissing = ["42P01", "PGRST205"].includes(historyError?.code ?? "");
  if (historyError && !migrationMissing) throw historyError;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted)]">
          <Link href={`/courses/${course.id}`} className="hover:underline">
            {course.name}
          </Link>
        </p>
        <h1 className="page-title mt-1">שליחה לנרשמים</h1>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          הודעה אחת, עכשיו, לקבוצה שתבחר מתוך הנרשמים לקורס. בניגוד למסע ולתזכורת
          — שרצים מעצמם לפי תנאי — כאן אתה מחליט מה יוצא ומתי, פעם אחת.
        </p>
      </div>

      <SendingPausedNotice />

      {migrationMissing ? (
        <div className="card border-[var(--nav-amber)]">
          <p className="font-semibold text-[var(--nav-amber)]">המיגרציה עוד לא רצה</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            יש להריץ את{" "}
            <span dir="ltr" className="slug">
              supabase/migrations/0032_course_broadcasts.sql
            </span>{" "}
            ב-SQL editor של Supabase, ואז לרענן את הדף.
          </p>
        </div>
      ) : (
        <BroadcastCompose courseId={course.id} counts={counts} templates={templates} />
      )}

      {(historyRaw?.length ?? 0) > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="card-title">מה כבר נשלח</h2>
          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="th">מתי</th>
                  <th className="th">ערוץ</th>
                  <th className="th">מה נשלח</th>
                  <th className="th">למי</th>
                  <th className="th">נמסר</th>
                </tr>
              </thead>
              <tbody>
                {(historyRaw ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="td text-[var(--muted)]">{formatDateTime(row.created_at)}</td>
                    <td className="td">{row.channel === "email" ? "מייל" : "וואטסאפ"}</td>
                    <td className="td">
                      {row.channel === "email"
                        ? (row.subject ?? "—")
                        : (row.message_templates?.name ?? "תבנית שנמחקה")}
                    </td>
                    <td className="td text-[var(--muted)]">
                      {row.stages.map((s: CourseStage) => COURSE_STAGE_LABELS[s]).join(" · ")}
                    </td>
                    <td className="td">
                      {/* "יוצאת עכשיו" הוא מצב אמיתי ולא ביניים טכני: שליחה
                          גדולה נפרסת על כמה ריצות קרון, והמונים כאן זזים
                          בכל אחת מהן. */}
                      <span className={row.status === "sending" ? "text-[var(--nav-amber)]" : ""}>
                        {row.sent_count}
                        {row.failed_count > 0 && (
                          <span className="text-[var(--danger)]"> · {row.failed_count} נכשלו</span>
                        )}
                        {row.status === "sending" && " · עוד יוצאת"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
