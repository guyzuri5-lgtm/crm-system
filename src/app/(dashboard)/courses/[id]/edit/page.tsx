import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
import { getCourseById } from "@/lib/courses";
import { CourseDesignEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function EditCoursePage({ params }: PageProps<"/courses/[id]/edit">) {
  await verifyTeamMember();
  const { id } = await params;

  const course = await getCourseById(id);
  if (!course) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">עיצוב דף ההרשמה — {course.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            כל שינוי מופיע מיד בתצוגה שמימין. זה בדיוק מה שהלקוחה תראה.
          </p>
        </div>
        <Link href={`/courses/${course.id}`} className="btn-secondary">
          חזרה למסך הקורס
        </Link>
      </div>

      <CourseDesignEditor course={course} />
    </div>
  );
}
