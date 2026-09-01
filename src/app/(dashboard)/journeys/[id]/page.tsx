import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  JOURNEY_ENTRY_LABELS,
  JOURNEY_STATE_LABELS,
  JOURNEY_CONDITIONS,
  JOURNEY_CONDITION_LABELS,
  MESSAGE_CHANNELS,
  type Journey,
  type JourneyStep,
  type JourneyEnrollment,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import {
  addStepAction,
  deleteStepAction,
  toggleJourneyAction,
  deleteJourneyAction,
  stopEnrollmentAction,
  toggleStopOnReplyAction,
} from "../actions";
import { JourneyFlow } from "./flow";

export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  await verifyTeamMember();
  const { id } = await params;

  const db = supabaseAdmin();
  const { data: journeyRaw, error } = await db
    .from("journeys")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!journeyRaw) notFound();

  const journey = journeyRaw as Journey;

  const [{ data: stepsRaw }, { data: templatesRaw }, { data: enrollmentsRaw }] =
    await Promise.all([
      db.from("journey_steps").select("*").eq("journey_id", id).order("position"),
      db.from("message_templates").select("*").order("name"),
      db
        .from("journey_enrollments")
        .select("*")
        .eq("journey_id", id)
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);

  const steps = (stepsRaw ?? []) as JourneyStep[];
  const templates = (templatesRaw ?? []) as MessageTemplate[];
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const enrollments = (enrollmentsRaw ?? []) as JourneyEnrollment[];

  // שליפה נפרדת ולא הטמעה: Relationships ב-database.types.ts ריק בכוונה
  // (ר' ההערה שם), ולכן PostgREST embedding אינו מקבל טיפוס.
  const { data: contactsRaw } = enrollments.length
    ? await db
        .from("contacts")
        .select("id, full_name, phone")
        .in("id", enrollments.map((e) => e.contact_id))
    : { data: [] };
  const contactById = new Map((contactsRaw ?? []).map((c) => [c.id, c]));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/journeys" className="text-sm text-[var(--muted)] hover:underline">
            ← כל המסעות
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{journey.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            נכנסים למסע: {JOURNEY_ENTRY_LABELS[journey.entry_type]}
            {journey.entry_type === "status" && journey.entry_value?.status
              ? ` — ${journey.entry_value.status}`
              : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <form action={toggleJourneyAction}>
            <input type="hidden" name="id" value={journey.id} />
            <input type="hidden" name="active" value={String(!journey.active)} />
            <button type="submit" className={journey.active ? "btn-ghost" : "btn-primary"}>
              {journey.active ? "כבה מסע" : "הפעל מסע"}
            </button>
          </form>
          <form action={deleteJourneyAction}>
            <input type="hidden" name="id" value={journey.id} />
            <button type="submit" className="btn-danger">
              מחיקה
            </button>
          </form>
        </div>
      </div>

      {journey.active && (
        <div className="card border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          <strong>המסע פעיל.</strong> הקרון היומי מצרף אליו אנשים ושולח להם הודעות
          אמיתיות. שינוי שלבים עכשיו משפיע גם על מי שכבר באמצע.
        </div>
      )}

      {/* ── הקנבס ─────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-1 font-medium">המסע</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">
          כך הוא נראה מנקודת מבטו של הלקוח, משמאל לימין.
        </p>

        <form action={toggleStopOnReplyAction} className="mb-4">
          <input type="hidden" name="id" value={journey.id} />
          <input type="hidden" name="stop_on_reply" value={String(!journey.stop_on_reply)} />
          <button
            type="submit"
            className="text-xs text-[var(--primary)] hover:underline"
          >
            {journey.stop_on_reply
              ? "תגובה מסיימת את המסע — לחצו כדי לאפשר מסלולים נפרדים"
              : "מסלולים נפרדים פעילים — לחצו כדי שתגובה תסיים את המסע"}
          </button>
        </form>
        <JourneyFlow
          journeyId={journey.id}
          stopOnReply={journey.stop_on_reply}
          entryLabel={
            JOURNEY_ENTRY_LABELS[journey.entry_type] +
            (journey.entry_type === "status" && journey.entry_value?.status
              ? `: ${journey.entry_value.status}`
              : "")
          }
          steps={steps.map((s) => ({
            id: s.id,
            position: s.position,
            waitDays: s.wait_days,
            channel: s.channel,
            templateName: templateById.get(s.template_id)?.name ?? "תבנית חסרה",
            condition: s.condition,
          }))}
        />
      </section>

      {/* ── עריכת שלבים ────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-4 font-medium">שלבים</h2>

        <div className="flex flex-col gap-2">
          {steps.map((step) => {
            const template = templateById.get(step.template_id);
            return (
              <div
                key={step.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="grid size-6 place-items-center rounded-full bg-[var(--background)] text-xs font-bold">
                    {step.position}
                  </span>
                  <span className="text-[var(--muted)]">
                    {step.wait_days === 0 ? "מיד" : `אחרי ${step.wait_days} ימים`}
                  </span>
                  <span className="font-medium">
                    {step.channel === "email" ? "מייל" : "וואטסאפ"}: {template?.name ?? "תבנית חסרה"}
                  </span>
                  {step.condition !== "always" && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {JOURNEY_CONDITION_LABELS[step.condition]}
                    </span>
                  )}
                </div>
                <form action={deleteStepAction}>
                  <input type="hidden" name="id" value={step.id} />
                  <input type="hidden" name="journey_id" value={journey.id} />
                  <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                    הסר
                  </button>
                </form>
              </div>
            );
          })}
          {!steps.length && (
            <p className="text-sm text-[var(--subtle)]">
              אין עדיין שלבים. מסע בלי שלבים אי אפשר להפעיל.
            </p>
          )}
        </div>

        <form
          action={addStepAction}
          className="mt-6 grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-6 md:grid-cols-4"
        >
          <input type="hidden" name="journey_id" value={journey.id} />

          <label className="field-label">
            להמתין (ימים)
            <input
              name="wait_days"
              type="number"
              min={0}
              max={365}
              defaultValue={steps.length ? 2 : 0}
              className="input"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              מהשלב הקודם. 0 = מיד.
            </span>
          </label>

          <label className="field-label">
            ערוץ
            <select name="channel" className="input" required defaultValue="whatsapp">
              {MESSAGE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c === "email" ? "מייל" : "וואטסאפ"}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            תבנית
            <select name="template_id" className="input" required defaultValue="">
              <option value="" disabled>
                בחרו תבנית
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.channel === "whatsapp" && !t.meta_template_name ? " (בלי תבנית ב-Meta)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            מתי לשלוח
            <select name="condition" className="input" defaultValue="always">
              {JOURNEY_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {JOURNEY_CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
            <span className="text-xs font-normal text-[var(--subtle)]">
              תנאי עובד רק כשתגובה אינה מסיימת את המסע.
            </span>
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-4">
            הוסף שלב
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-[var(--subtle)]">
          שלב וואטסאפ שנשלח מחוץ לחלון 24 השעות חייב תבנית שאושרה ב-Meta. תבנית בלי
          קישור כזה תיכשל — במפורש, לא בשקט.
        </p>
      </section>

      {/* ── מי במסע ────────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-4 font-medium">מי במסע</h2>
        <div className="flex flex-col gap-2">
          {enrollments.map((e) => {
            const contact = contactById.get(e.contact_id);
            return (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-2 text-sm last:border-0"
            >
              <div className="flex flex-wrap items-center gap-3">
                {contact ? (
                  <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                    {contact.full_name || contact.phone || "ללא שם"}
                  </Link>
                ) : (
                  <span className="text-[var(--subtle)]">איש קשר נמחק</span>
                )}
                <span className="text-xs text-[var(--subtle)]">
                  {JOURNEY_STATE_LABELS[e.state] ?? e.state}
                  {e.state === "active" && ` · שלב ${e.next_position}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {e.state === "active" && (
                  <>
                    <span className="text-xs text-[var(--subtle)]">
                      הבא: {new Date(e.next_run_at).toLocaleDateString("he-IL")}
                    </span>
                    <form action={stopEnrollmentAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="journey_id" value={journey.id} />
                      <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                        עצור
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
            );
          })}
          {!enrollments.length && (
            <p className="text-sm text-[var(--subtle)]">
              עדיין אף אחד. אנשים מצטרפים בריצת הקרון היומית, אחרי שהמסע מופעל.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
