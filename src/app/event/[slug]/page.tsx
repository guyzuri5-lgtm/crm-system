import { notFound } from "next/navigation";
import { countStages, getActiveEventBySlug, spotsLeft } from "@/lib/events";
import { EventLanding } from "@/components/event-page";
import { registerForEventAction } from "./actions";

// דף ההרשמה הציבורי. רץ בלי משתמש מחובר — ראו PUBLIC_PATHS ב-src/proxy.ts.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/event/[slug]">) {
  const { slug } = await params;
  const event = await getActiveEventBySlug(slug);
  if (!event) return { title: "האירוע לא נמצא" };
  return {
    title: event.name,
    description: event.subtitle ?? event.description ?? undefined,
  };
}

export default async function EventPage({ params }: PageProps<"/event/[slug]">) {
  const { slug } = await params;
  const event = await getActiveEventBySlug(slug);
  if (!event) notFound();

  const counts = await countStages(event.id);

  return (
    <EventLanding
      design={event}
      spotsLeft={spotsLeft(event, counts.paid)}
      // ה-slug נכרך כאן ולא נשלח כשדה נסתר בטופס: שדה בטופס הוא קלט מהדפדפן,
      // ואפשר להחליף אותו בכלי הפיתוח כדי להירשם לאירוע אחר.
      action={registerForEventAction.bind(null, slug)}
    />
  );
}
