import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
import { getEventById, EVENT_TIMEZONE } from "@/lib/events";
import { minutesToClock, utcToZonedParts, zonedDateKey } from "@/lib/booking/timezone";
import { EventDesignEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function EditEventPage({ params }: PageProps<"/events/[id]/edit">) {
  await verifyTeamMember();
  const { id } = await params;

  const event = await getEventById(id);
  if (!event) notFound();

  // המועד נפרק לתאריך ולשעה כאן ולא בלקוח: השרת יודע את אזור הזמן של האירוע
  // בוודאות, ופירוק בדפדפן היה מציג למי שיושבת בחו"ל שעה אחרת מזו שתופיע
  // בדף ההרשמה.
  const startsAt = new Date(event.starts_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">עיצוב דף ההרשמה — {event.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            כל שינוי מופיע מיד בתצוגה שמימין. זה בדיוק מה שהלקוחה תראה.
          </p>
        </div>
        <Link href={`/events/${event.id}`} className="btn-secondary">
          חזרה למסך האירוע
        </Link>
      </div>

      <EventDesignEditor
        event={event}
        initialDate={zonedDateKey(startsAt, EVENT_TIMEZONE)}
        initialTime={minutesToClock(utcToZonedParts(startsAt, EVENT_TIMEZONE).minutes)}
      />
    </div>
  );
}
