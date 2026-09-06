import { notFound } from "next/navigation";
import { countStages, getActiveEventBySlug, spotsLeft } from "@/lib/events";
import { RegistrationEmbed } from "@/components/registration-page";
import { EmbedFrame, parseEmbedStyle } from "@/components/embed-frame";
import { registerForEventEmbedAction } from "../actions";

/**
 * גרסת ההטמעה של טופס ההרשמה — נטענת בתוך iframe בדף נחיתה קיים.
 *
 * שלושה הבדלים מהדף המלא, וכולם נובעים מאותו עיקרון: הדף המארח הוא הבעלים
 * של העיצוב, והטופס הוא אורח.
 *   1. בלי תמונת רקע, בלי כותרות ובלי פריסת מסך מלא (ראו layout.tsx כאן).
 *   2. הטוקנים והרקע מגיעים מ-EmbedFrame — שפת דף הנחיתה, לא של המערכת.
 *   3. הסיום קורה בלקוח: תשלום לוקח את כל החלון, תודה מוצגת במקום.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  // הטופס עצמו לא אמור להתחרות בדף המארח בתוצאות החיפוש.
  robots: { index: false, follow: false },
};

export default async function EventEmbedPage({ params, searchParams }: PageProps<"/event/[slug]/embed"> ) {
  const { slug } = await params;
  // שני המתגים של ההטמעה: mode=bare ו-accent. ראו embed-frame.
  const style = parseEmbedStyle(await searchParams);
  const event = await getActiveEventBySlug(slug);
  if (!event) notFound();

  const counts = await countStages(event.id);

  return (
    <EmbedFrame style={style}>
      <RegistrationEmbed
        design={event}
        spotsLeft={event.show_capacity ? spotsLeft(event, counts.paid) : null}
        action={registerForEventEmbedAction.bind(null, slug)}
        thanksTitle={event.thankyou_title}
        thanksText={event.thankyou_text}
        embedId={event.slug}
      />
    </EmbedFrame>
  );
}
