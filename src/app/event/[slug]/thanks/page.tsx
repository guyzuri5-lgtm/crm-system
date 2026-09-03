import { notFound } from "next/navigation";
import { getActiveEventBySlug, googleCalendarUrl } from "@/lib/events";
import { EventThanks } from "@/components/event-page";

/**
 * עמוד התודה.
 *
 * כשיש תשלום, זו הכתובת שגרואו מפנה אליה אחרי תשלום מוצלח — כלומר הכניסה
 * אליו מגיעה מדומיין אחר, בלי session ובלי פרמטרים מהטופס. לכן הוא נגזר
 * מה-slug בלבד ואינו מנסה לדעת מי הנרשמת.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/event/[slug]/thanks">) {
  const { slug } = await params;
  const event = await getActiveEventBySlug(slug);
  return { title: event ? event.thankyou_title : "האירוע לא נמצא" };
}

export default async function EventThanksPage({ params }: PageProps<"/event/[slug]/thanks">) {
  const { slug } = await params;
  const event = await getActiveEventBySlug(slug);
  if (!event) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <EventThanks
          design={event}
          googleUrl={googleCalendarUrl(event)}
          icsUrl={`/api/events/${event.id}/ics`}
        />
      </div>
    </div>
  );
}
