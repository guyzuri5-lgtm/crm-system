import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/dates";
import {
  JOURNEY_STATE_LABELS,
  type JourneyState,
  type MetaLeadForm,
} from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * לקוחות ← לידים מטפסים.
 *
 * המסך עונה על שאלה אחת שלא הייתה לה תשובה בשום מקום: **מה קרה ללידים
 * שנכנסו מהפרסום.** עד כאן אפשר היה לראות איש קשר (מי הוא) או מסע (כמה
 * נכנסו אליו), אבל לא את החיבור — האם הליד שנכנס אתמול בכלל נתפס על ידי
 * מסע, ואיפה הוא עומד בו עכשיו.
 *
 * ליד בלי שום תג מסע הוא הממצא החשוב במסך: הוא אומר שהפרסום עובד ושהמעקב
 * לא. זו הסיבה שהתג "לא במסע" נצבע ולא נשאר שקט.
 */

// 150 ולא הכול: המסך הוא לבדיקה יומית ולא לארכיון, והשליפות הנלוות (אנשי
// קשר, צירופים) גדלות איתו.
const LIMIT = 150;

/** חלוקה לקבוצות בגלל מגבלת אורך ה-URL של PostgREST ב-‎.in()‎. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await verifyTeamMember();

  const query = await searchParams;
  const formFilter = typeof query.form === "string" ? query.form : null;

  const db = supabaseAdmin();

  let leadsQuery = db
    .from("meta_form_leads")
    .select("id, form_id, contact_id, created_at")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (formFilter) leadsQuery = leadsQuery.eq("form_id", formFilter);

  const [{ data: leadsRaw, error }, { data: formsRaw }] = await Promise.all([
    leadsQuery,
    db.from("meta_lead_forms").select("*").order("first_seen_at", { ascending: false }),
  ]);

  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    throw new Error(
      "טבלאות הלידים לא קיימות. יש להריץ את supabase/migrations/0044_lead_forms.sql ב-SQL editor של Supabase."
    );
  }
  if (error) throw error;

  const leads = leadsRaw ?? [];
  const forms = (formsRaw ?? []) as MetaLeadForm[];
  const formName = (id: string) => forms.find((f) => f.form_id === id)?.name?.trim() || `טופס ${id}`;

  const contactIds = Array.from(new Set(leads.map((l) => l.contact_id)));

  // שתי השליפות התלויות יוצאות יחד ולא בטור — הן אינן תלויות זו בזו, ושתיהן
  // תלויות רק ברשימת המזהים שכבר בידינו.
  const [contactChunks, enrollmentChunks] = await Promise.all([
    Promise.all(
      chunk(contactIds, 50).map((ids) =>
        db.from("contacts").select("id, full_name, phone, email, status").in("id", ids)
      )
    ),
    Promise.all(
      chunk(contactIds, 50).map((ids) =>
        db
          .from("journey_enrollments")
          .select("contact_id, journey_id, state")
          .in("contact_id", ids)
      )
    ),
  ]);

  const contactById = new Map<
    string,
    { id: string; full_name: string | null; phone: string | null; email: string | null; status: string }
  >();
  for (const res of contactChunks) for (const c of res.data ?? []) contactById.set(c.id, c);

  const enrollments = enrollmentChunks.flatMap((res) => res.data ?? []);
  const journeyIds = Array.from(new Set(enrollments.map((e) => e.journey_id)));
  const { data: journeysRaw } = journeyIds.length
    ? await db.from("journeys").select("id, name").in("id", journeyIds)
    : { data: [] };
  const journeyName = new Map((journeysRaw ?? []).map((j) => [j.id, j.name]));

  const byContact = new Map<string, { name: string; state: JourneyState }[]>();
  for (const e of enrollments) {
    const list = byContact.get(e.contact_id) ?? [];
    list.push({ name: journeyName.get(e.journey_id) ?? "מסע שנמחק", state: e.state });
    byContact.set(e.contact_id, list);
  }

  const inJourney = leads.filter((l) => (byContact.get(l.contact_id) ?? []).length > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">לידים מטפסים</h1>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          מי השאיר פרטים בטופס פרסום במטא, ומה קרה לו מאז. ליד שאין לידו תג מסע הוא ליד
          שהפרסום הביא ואף אחד לא פנה אליו.
        </p>
      </div>

      {forms.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip href="/leads" label="כל הטפסים" active={!formFilter} />
          {forms.map((f) => (
            <FilterChip
              key={f.form_id}
              href={`/leads?form=${encodeURIComponent(f.form_id)}`}
              label={f.name?.trim() || `טופס ${f.form_id}`}
              active={formFilter === f.form_id}
            />
          ))}
        </div>
      )}

      {leads.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">
          עוד לא נקלט אף ליד. כשהקמפיין יעלה, הלידים יופיעו כאן תוך שניות מרגע שמישהו שולח
          את הטופס.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--subtle)]">
            {leads.length} לידים · {inJourney} מתוכם נתפסו על ידי מסע
            {leads.length === LIMIT && " · מוצגים האחרונים בלבד"}
          </p>

          <section className="flex flex-col gap-2">
            {leads.map((lead) => {
              const contact = contactById.get(lead.contact_id);
              const journeys = byContact.get(lead.contact_id) ?? [];
              return (
                <Link
                  key={lead.id}
                  href={`/contacts/${lead.contact_id}`}
                  className="card hover:border-[var(--primary)]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {contact?.full_name?.trim() || "ללא שם"}
                    </span>
                    <span className="text-xs text-[var(--subtle)]">
                      {formatDateTime(lead.created_at, {
                        day: "numeric",
                        month: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--subtle)]">
                    {contact?.phone && <span dir="ltr">{contact.phone}</span>}
                    {contact?.phone && contact?.email && <span aria-hidden="true">·</span>}
                    {contact?.email && <span dir="ltr">{contact.email}</span>}
                    <span aria-hidden="true">·</span>
                    <span>{formName(lead.form_id)}</span>
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {journeys.length === 0 ? (
                      <span className="rounded-full bg-[var(--warn-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warn)] ring-1 ring-inset ring-[var(--warn)]/25">
                        לא במסע
                      </span>
                    ) : (
                      journeys.map((j, i) => (
                        <span
                          key={i}
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                            j.state === "active"
                              ? "bg-[var(--ok-soft)] text-[var(--ok)] ring-[var(--ok)]/25"
                              : "bg-[var(--surface-sunken)] text-[var(--muted)] ring-[var(--border)]"
                          }`}
                        >
                          {j.name} · {JOURNEY_STATE_LABELS[j.state]}
                        </span>
                      ))
                    )}
                  </div>
                </Link>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
        active
          ? "bg-[var(--primary-soft)] text-[var(--primary)] ring-[var(--primary)]/25"
          : "bg-[var(--surface)] text-[var(--muted)] ring-[var(--border)] hover:border-[var(--primary)]"
      }`}
    >
      {label}
    </Link>
  );
}
