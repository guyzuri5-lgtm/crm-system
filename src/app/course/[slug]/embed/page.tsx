import { notFound } from "next/navigation";
import { getActiveCourseBySlug } from "@/lib/courses";
import { RegistrationEmbed } from "@/components/registration-page";
import { EmbedFrame, parseEmbedStyle } from "@/components/embed-frame";
import { registerForCourseEmbedAction } from "../actions";

/**
 * גרסת ההטמעה של טופס ההרשמה לקורס — נטענת בתוך iframe בדף נחיתה קיים.
 *
 * שלושה הבדלים מהדף המלא, וכולם נובעים מאותו עיקרון: הדף המארח הוא הבעלים
 * של העיצוב, והטופס הוא אורח.
 *   1. בלי תמונת רקע, בלי כותרות ובלי פריסת מסך מלא.
 *   2. הטוקנים והרקע מגיעים מ-EmbedFrame — שפת דף הנחיתה, לא של המערכת.
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

export default async function CourseEmbedPage({ params, searchParams }: PageProps<"/course/[slug]/embed">) {
  const { slug } = await params;
  // שני המתגים של ההטמעה: mode=bare ו-accent. ראו embed-frame.
  const style = parseEmbedStyle(await searchParams);
  const course = await getActiveCourseBySlug(slug);
  if (!course) notFound();

  return (
    <EmbedFrame style={style}>
      <RegistrationEmbed
        design={course}
        spotsLeft={null}
        action={registerForCourseEmbedAction.bind(null, slug)}
        thanksTitle={course.thankyou_title}
        thanksText={course.thankyou_text}
        embedId={course.slug}
      />
    </EmbedFrame>
  );
}
