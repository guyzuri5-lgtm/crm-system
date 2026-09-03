import { notFound } from "next/navigation";
import { countStages, getActiveEventBySlug, spotsLeft } from "@/lib/events";
import { EventEmbed } from "@/components/event-page";
import { registerForEventEmbedAction } from "../actions";

/**
 * גרסת ההטמעה של טופס ההרשמה — נטענת בתוך iframe בדף נחיתה קיים.
 *
 * שלושה הבדלים מהדף המלא, וכולם נובעים מאותו עיקרון: הדף המארח הוא הבעלים
 * של העיצוב, והטופס הוא אורח.
 *   1. בלי תמונת רקע, בלי כותרות ובלי פריסת מסך מלא (ראו layout.tsx כאן).
 *   2. רקע שקוף — הצבע של דף הנחיתה נראה מבעד למסגרת.
 *   3. הסיום קורה בלקוח: תשלום לוקח את כל החלון, תודה מוצגת במקום.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  // הטופס עצמו לא אמור להתחרות בדף המארח בתוצאות החיפוש.
  robots: { index: false, follow: false },
};

export default async function EventEmbedPage({ params }: PageProps<"/event/[slug]/embed"> ) {
  const { slug } = await params;
  const event = await getActiveEventBySlug(slug);
  if (!event) notFound();

  const counts = await countStages(event.id);

  return (
    <>
      {/* הרקע של המערכת מוסר כאן בלבד. body מקבל את הצבע שלו מ-globals.css,
          ובתוך iframe זה היה מצייר מלבן קרם על דף נחיתה בכל צבע אחר. */}
      <style>{`body{background:transparent!important}`}</style>
      <div className="p-1">
        <EventEmbed
          design={event}
          spotsLeft={event.show_capacity ? spotsLeft(event, counts.paid) : null}
          action={registerForEventEmbedAction.bind(null, slug)}
          thanksTitle={event.thankyou_title}
          thanksText={event.thankyou_text}
          embedId={event.slug}
        />
      </div>
    </>
  );
}
