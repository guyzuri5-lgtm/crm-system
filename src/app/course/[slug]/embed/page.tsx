import { notFound } from "next/navigation";
import { getActiveCourseBySlug } from "@/lib/courses";
import { RegistrationEmbed } from "@/components/registration-page";
import { registerForCourseEmbedAction } from "../actions";

/**
 * גרסת ההטמעה של טופס ההרשמה לקורס — נטענת בתוך iframe בדף נחיתה קיים.
 *
 * שלושה הבדלים מהדף המלא, וכולם נובעים מאותו עיקרון: הדף המארח הוא הבעלים
 * של העיצוב, והטופס הוא אורח.
 *   1. בלי תמונת רקע, בלי כותרות ובלי פריסת מסך מלא.
 *   2. רקע שקוף — הצבע של דף הנחיתה נראה מבעד למסגרת.
 *   3. הסיום קורה בלקוח: תשלום לוקח את כל החלון, תודה מוצגת במקום.
 *
 * אין כאן כותרות X-Frame-Options/CSP חוסמות, ואין הגדרת headers גלובלית
 * ב-next.config.ts שצריך להחריג ממנה — נבדק.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  // הטופס עצמו לא אמור להתחרות בדף המארח בתוצאות החיפוש.
  robots: { index: false, follow: false },
};

export default async function CourseEmbedPage({ params }: PageProps<"/course/[slug]/embed">) {
  const { slug } = await params;
  const course = await getActiveCourseBySlug(slug);
  if (!course) notFound();

  return (
    <>
      {/* הרקע של המערכת מוסר כאן בלבד. body מקבל את הצבע שלו מ-globals.css,
          ובתוך iframe זה היה מצייר מלבן קרם על דף נחיתה בכל צבע אחר. */}
      <style>{`body{background:transparent!important}`}</style>
      <div className="p-1">
        <RegistrationEmbed
          design={course}
          spotsLeft={null}
          action={registerForCourseEmbedAction.bind(null, slug)}
          thanksTitle={course.thankyou_title}
          thanksText={course.thankyou_text}
          embedId={course.slug}
        />
      </div>
    </>
  );
}
