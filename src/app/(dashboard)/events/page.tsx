import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertEventsMigrated, EVENT_TIMEZONE } from "@/lib/events";
import { formatDateTime, hasPassed } from "@/lib/booking/timezone";
import type { EventRow, EventStage } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type Counts = Record<EventStage, number>;

/**
 * שאילתה אחת לכל ההרשמות ולא שלוש לכל אירוע.
 *
 * הרשימה מציגה תשעה מספרים לתשעה אירועים; בגרסה הישירה זה עשרים ושבע
 * שאילתות. כאן נשלפים שני שדות לכל שורת הרשמה והספירה נעשית בזיכרון —
 * זול יותר בכל סדר גודל שרשימת אירועים מגיעה אליו.
 */
async function countsByEvent(): Promise<Map<string, Counts>> {
  const { data, error } = await supabaseAdmin()
    .from("event_registrations")
    .select("event_id, stage");

  assertEventsMigrated(error);
  if (error) throw error;

  const map = new Map<string, Counts>();
  for (const row of data ?? []) {
    const counts = map.get(row.event_id) ?? { interested: 0, registered: 0, paid: 0 };
    counts[row.stage] += 1;
    map.set(row.event_id, counts);
  }
  return map;
}

export default async function EventsPage() {
  await verifyTeamMember();

  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .order("starts_at", { ascending: false });

  assertEventsMigrated(error);
  if (error) throw error;

  const events = (data ?? []) as EventRow[];
  const counts = await countsByEvent();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">כל האירועים</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            כל אירוע מקבל דף הרשמה משלו בכתובת ציבורית, ותזכורות בוואטסאפ למי ששילמה.
          </p>
        </div>
        <Link href="/events/new" className="btn-primary">
          אירוע חדש
        </Link>
      </div>

      {events.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-[var(--muted)]">עוד אין אירועים.</p>
          <Link href="/events/new" className="btn-secondary mt-4">
            יצירת האירוע הראשון
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => {
            const c = counts.get(event.id) ?? { interested: 0, registered: 0, paid: 0 };
            const isPast = hasPassed(new Date(event.starts_at));

            return (
              <Link key={event.id} href={`/events/${event.id}`} className="card block hover:border-[var(--border-strong)]">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{event.name}</h2>
                      <Badge past={isPast || !event.active} label={eventTag(event, isPast)} />
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatDateTime(new Date(event.starts_at), EVENT_TIMEZONE)}
                      {event.location ? ` · ${event.location}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-5 text-center">
                    <Metric value={c.paid} label="שילמו" tone="var(--primary)" />
                    <Metric value={c.registered} label="לא שילמו" tone="var(--nav-pink)" />
                    <Metric value={c.interested} label="מתעניינות" tone="var(--nav-amber)" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function eventTag(event: EventRow, isPast: boolean): string {
  if (!event.active) return "כבוי";
  return isPast ? "עבר" : "פעיל";
}

function Badge({ past, label }: { past: boolean; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        backgroundColor: past ? "var(--nav-gray-soft)" : "var(--primary-soft)",
        color: past ? "var(--nav-gray)" : "var(--primary)",
      }}
    >
      {label}
    </span>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <p className="text-lg font-bold" style={{ color: tone }}>
        {value}
      </p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
