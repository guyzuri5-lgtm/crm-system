import { notFound } from "next/navigation";
import { getActiveCourseBySlug } from "@/lib/courses";
import { RegistrationThanks } from "@/components/registration-page";

/**
 * עמוד התודה.
 *
 * כשיש תשלום, זו הכתובת שגרואו מפנה אליה אחרי תשלום מוצלח — כלומר הכניסה
 * אליו מגיעה מדומיין אחר, בלי session ובלי פרמטרים מהטופס. לכן הוא נגזר
 * מה-slug בלבד ואינו מנסה לדעת מי הנרשמת.
 *
 * אין כאן כפתורי יומן: לקורס אין מועד. thankyou_show_calendar כלל אינו עמודה
 * בטבלת courses, ולכן הוא undefined והבלוק אינו מרונדר.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/course/[slug]/thanks">) {
  const { slug } = await params;
  const course = await getActiveCourseBySlug(slug);
  return { title: course ? course.thankyou_title : "הקורס לא נמצא" };
}

export default async function CourseThanksPage({ params }: PageProps<"/course/[slug]/thanks">) {
  const { slug } = await params;
  const course = await getActiveCourseBySlug(slug);
  if (!course) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <RegistrationThanks design={course} />
      </div>
    </div>
  );
}
