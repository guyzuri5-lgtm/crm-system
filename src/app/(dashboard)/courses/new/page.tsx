import { verifyTeamMember } from "@/lib/dal";
import { NewCourseForm } from "./new-course-form";

export const dynamic = "force-dynamic";

export default async function NewCoursePage() {
  await verifyTeamMember();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">קורס חדש</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          קודם השם והכתובת. אחרי השמירה נעבור לעיצוב דף ההרשמה — כותרת, תמונה, טקסטים ושדות הטופס.
        </p>
      </div>

      <NewCourseForm />
    </div>
  );
}
