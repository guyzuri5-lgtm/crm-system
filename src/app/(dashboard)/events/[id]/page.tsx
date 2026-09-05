import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertEventsMigrated, countStages, EVENT_TIMEZONE, getEventById, spotsLeft } from "@/lib/events";
import { formatDateTime } from "@/lib/booking/timezone";
import {
  EVENT_SOURCE_LABELS,
  EVENT_STAGE_LABELS,
  type Contact,
  type EventStage,
  type EventSource,
  type EventReminder,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "../../booking/copy-link";
import { CopyEmbed } from "@/components/copy-embed";
import { EventReminders } from "./reminders";
import { markPaidAction } from "../actions";

export const dynamic = "force-dynamic";

type RegistrationRow = {
  id: string;
  stage: EventStage;
  source: EventSource;
  created_at: string;
  paid_at: string | null;
  contacts: Contact | null;
};

type ReminderRow = EventReminder & { template: MessageTemplate | null };

/** תג צבעוני לכל שלב, באותה שפה ויזואלית של תגי הסטטוס במערכת. */
const STAGE_TONE: Record<EventStage, { bg: string; text: string }> = {
  paid: { bg: "var(--primary-soft)", text: "var(--primary)" },
  interested: { bg: "var(--nav-amber-soft)", text: "var(--nav-amber)" },
  registered: { bg: "var(--nav-pink-soft)", text: "var(--nav-pink)" },
};

export default async function EventPage({ params }: PageProps<"/events/[id]">) {
  await verifyTeamMember();
  const { id } = await params;

  const event = await getEventById(id);
  if (!event) notFound();

  const [counts, { data, error }, { data: remindersRaw }, { data: templatesRaw }] =
    await Promise.all([
      countStages(event.id),
      supabaseAdmin()
        .from("event_registrations")
        .select("id, stage, source, created_at, paid_at, contacts(*)")
        .eq("event_id", event.id)
        .order("created_at", { ascending: false })
        .returns<RegistrationRow[]>(),
      // התזכורות והתבניות. שגיאה כאן (0027 שטרם רץ) לא מפילה את המסך —
      // כרטיס התזכורות פשוט יוצג ריק.
      supabaseAdmin()
        .from("event_reminders")
        .select("*, template:message_templates(*)")
        .eq("event_id", event.id)
        .order("created_at")
        .returns<ReminderRow[]>(),
      supabaseAdmin().from("message_templates").select("*").eq("channel", "whatsapp"),
    ]);

  assertEventsMigrated(error);
  if (error) throw error;

  const registrations = data ?? [];
  const left = spotsLeft(event, counts.paid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{event.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {formatDateTime(new Date(event.starts_at), EVENT_TIMEZONE)}
            {event.location ? ` · ${event.location}` : ""}
            {left !== null ? ` · נותרו ${left} מקומות` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <CopyLink path={`/event/${event.slug}`} label="העתקת לינק ההרשמה" />
          <CopyEmbed slug={event.slug} fieldCount={event.custom_fields.length} />
          <Link href={`/events/${event.id}/edit`} className="btn-secondary">
            עיצוב הדף
          </Link>
          {/* פותח יצירת מסע עם הטריגר "נרשמה כמתעניינת לאירוע" מסומן מראש */}
          <Link href={`/journeys?event=${event.id}`} className="btn-primary">
            מסע למתעניינות
          </Link>
        </div>
      </div>

      <section className="card flex flex-col gap-5">
        {/* תפוסה: הקיבולת מחולקת לשלושה פלחים — מי ששילמה, מי ששריינה ולא
            שילמה, ומה שנשאר. זה המספר שנבדק כמה פעמים ביום לפני אירוע. */}
        {event.capacity ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between text-[11.5px] text-[var(--muted)]">
              <span>תפוסה</span>
              <span>
                <b className="tabular font-semibold text-[var(--foreground)]">{counts.paid}</b> מתוך{" "}
                {event.capacity}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="cap-track">
                <i
                  style={{
                    width: `${Math.min(100, (counts.paid / event.capacity) * 100)}%`,
                    backgroundColor: "var(--primary)",
                  }}
                />
                <i
                  style={{
                    width: `${Math.min(Math.max(0, 100 - (counts.paid / event.capacity) * 100), (counts.registered / event.capacity) * 100)}%`,
                    backgroundColor: "var(--nav-pink)",
                  }}
                />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-[var(--muted)]">
              <Legend color="var(--primary)" label={`שילמו ${counts.paid}`} />
              <Legend color="var(--nav-pink)" label={`שריון זמני ${counts.registered}`} />
              <Legend
                color="var(--surface-sunken)"
                label={`פנוי ${Math.max(0, event.capacity - counts.paid - counts.registered)}`}
              />
            </div>
          </div>
        ) : null}

        {/* המשפך קורא את אותם שלושה מספרים כירידה ולא כשלושה כרטיסים
            נפרדים — ההפרש בין השלבים הוא מה שמעניין, לא הערך המוחלט. */}
        <div className="flex flex-col gap-2.5">
          <FunnelRow label="מתעניינות" value={counts.interested} max={counts.interested} tone="var(--nav-amber)" />
          <FunnelRow label="נרשמו" value={counts.registered + counts.paid} max={counts.interested} tone="var(--nav-pink)" />
          <FunnelRow label="שילמו" value={counts.paid} max={counts.interested} tone="var(--primary)" />
        </div>
      </section>

      <EventReminders
        eventId={event.id}
        reminders={remindersRaw ?? []}
        templates={(templatesRaw ?? []) as MessageTemplate[]}
      />

      {registrations.length === 0 ? (
        <div className="card text-center text-sm text-[var(--muted)]">
          עוד אף אחת לא נרשמה. הקישור לדף ההרשמה מוכן להעתקה למעלה.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">שם</th>
                <th className="th">טלפון</th>
                <th className="th">אימייל</th>
                <th className="th">שלב</th>
                <th className="th">מקור</th>
                <th className="th">נרשמה</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((row) => (
                <tr key={row.id} className="tr-hover border-b border-[var(--border)] last:border-0">
                  <td className="td font-medium">
                    {row.contacts ? (
                      <Link href={`/contacts/${row.contacts.id}`} className="hover:underline">
                        {row.contacts.full_name ?? "—"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="td" dir="ltr">
                    {row.contacts?.phone ?? "—"}
                  </td>
                  <td className="td" dir="ltr">
                    {row.contacts?.email ?? "—"}
                  </td>
                  <td className="td">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: STAGE_TONE[row.stage].bg,
                        color: STAGE_TONE[row.stage].text,
                      }}
                    >
                      {EVENT_STAGE_LABELS[row.stage]}
                    </span>
                  </td>
                  <td className="td text-[var(--muted)]">{EVENT_SOURCE_LABELS[row.source]}</td>
                  <td className="td text-[var(--muted)]">
                    {formatDateTime(new Date(row.created_at), EVENT_TIMEZONE)}
                  </td>
                  <td className="td text-end">
                    {row.stage !== "paid" && (
                      // הגיבוי לגרואו: כל עוד אין webhook, זו הדרך לסגור את
                      // המעגל אחרי שרואים תשלום בפועל.
                      <ActionForm action={markPaidAction}>
                        <input type="hidden" name="registration_id" value={row.id} />
                        <input type="hidden" name="event_id" value={event.id} />
                        <button type="submit" className="btn-ghost whitespace-nowrap">
                          סימון כשילמה
                        </button>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className="block size-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** שורת משפך. הבסיס הוא תמיד השלב הרחב ביותר, אחרת הפסים לא ניתנים להשוואה. */
function FunnelRow({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="fn-row">
      <span className="fn-label">{label}</span>
      <span className="fn-track">
        <i style={{ width: `${pct}%`, backgroundColor: tone }} />
      </span>
      <span className="fn-value">{value}</span>
    </div>
  );
}
