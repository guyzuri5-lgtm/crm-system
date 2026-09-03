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
    // המעטפת יושבת כאן ולא ב-layout משותף: גרסת ההטמעה חולקת את אותו נתיב
    // אב, ופריסת מסך-מלא ממורכזת היא בדיוק מה שהיא לא צריכה. layout מקונן
    // לא יכול לבטל את זה של האב, ולכן העטיפה ירדה לדפים שרוצים אותה.
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <EventLanding
          design={event}
          spotsLeft={spotsLeft(event, counts.paid)}
          // ה-slug נכרך כאן ולא נשלח כשדה נסתר בטופס: שדה בטופס הוא קלט
          // מהדפדפן, ואפשר להחליף אותו בכלי הפיתוח כדי להירשם לאירוע אחר.
          action={registerForEventAction.bind(null, slug)}
        />
      </div>
    </div>
  );
}
