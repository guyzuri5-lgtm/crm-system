import { notFound } from "next/navigation";
import { getActiveCourseBySlug } from "@/lib/courses";
import { RegistrationLanding } from "@/components/registration-page";
import { registerForCourseAction } from "./actions";

// דף ההרשמה הציבורי לקורס. רץ בלי משתמש מחובר — ראו PUBLIC_PATHS ב-src/proxy.ts.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/course/[slug]">) {
  const { slug } = await params;
  const course = await getActiveCourseBySlug(slug);
  if (!course) return { title: "הקורס לא נמצא" };
  return {
    title: course.name,
    description: course.subtitle ?? course.description ?? undefined,
  };
}

export default async function CoursePage({ params }: PageProps<"/course/[slug]">) {
  const { slug } = await params;
  const course = await getActiveCourseBySlug(slug);
  if (!course) notFound();

  return (
    // המעטפת יושבת כאן ולא ב-layout משותף: גרסת ההטמעה חולקת את אותו נתיב אב,
    // ופריסת מסך-מלא ממורכזת היא בדיוק מה שהיא לא צריכה.
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <RegistrationLanding
          design={course}
          // לקורס דיגיטלי אין קיבולת — אין מלאי שנגמר, ולכן אין "מקומות
          // שנותרו" ואין מצב "מלא".
          spotsLeft={null}
          // ה-slug נכרך כאן ולא נשלח כשדה נסתר בטופס: שדה בטופס הוא קלט
          // מהדפדפן, ואפשר להחליף אותו בכלי הפיתוח כדי להירשם לקורס אחר.
          action={registerForCourseAction.bind(null, slug)}
        />
      </div>
    </div>
  );
}
