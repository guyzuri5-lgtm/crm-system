import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  JOURNEY_ENTRY_LABELS,
  JOURNEY_STATE_LABELS,
  JOURNEY_ANCHOR_LABELS,
  MESSAGE_CHANNELS,
  type Journey,
  type JourneyStep,
  type JourneyEdge,
  type JourneyEnrollment,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import {
  toggleJourneyAction,
  deleteJourneyAction,
  stopEnrollmentAction,
  toggleStopOnReplyAction,
} from "../actions";
import { JourneyCanvas } from "./canvas";
import { addNodeAction } from "./graph-actions";

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

  const { data: edgesRaw } = await db
    .from("journey_edges")
    .select("*")
    .eq("journey_id", id)
    .order("priority", { ascending: true });
  const edges = (edgesRaw ?? []) as JourneyEdge[];
  const templates = (templatesRaw ?? []) as MessageTemplate[];
  const templateById = new Map(templates.map((t) => [t.id, t]));
  // איפה כל אדם עומד — שם הכרטיסייה קריא יותר ממספר שלב, ובגרף אין ממילא מספר.
  const stepLabelById = new Map(
    steps.map((s) => [s.id, s.label || templateById.get(s.template_id)?.name || "כרטיסייה"])
  );
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
            {" · "}
            תזמון: {JOURNEY_ANCHOR_LABELS[journey.anchor]}
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
        <JourneyCanvas
          journeyId={journey.id}
          anchor={journey.anchor}
          entryLabel={
            JOURNEY_ENTRY_LABELS[journey.entry_type] +
            (journey.entry_type === "status" && journey.entry_value?.status
              ? `: ${journey.entry_value.status}`
              : "")
          }
          nodes={steps.map((s) => ({
            id: s.id,
            x: s.pos_x,
            y: s.pos_y,
            label: s.label,
            templateName: templateById.get(s.template_id)?.name ?? "תבנית חסרה",
            channel: s.channel,
            waitDays: s.wait_days,
            offsetMinutes: s.offset_minutes,
          }))}
          edges={edges.map((e) => ({
            id: e.id,
            fromId: e.from_step_id,
            toId: e.to_step_id,
            condition: e.condition,
          }))}
        />
      </section>

      {/* ── הוספת כרטיסייה ──────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-1 font-medium">כרטיסייה חדשה</h2>
        <p className="mb-4 text-sm text-[var(--muted)]">
          נוספת למשטח למעלה. הראשונה מתחברת אוטומטית לכניסה; את השאר מחברים בעצמכם
          עם החץ.
        </p>

        <form action={addNodeAction} className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <input type="hidden" name="journey_id" value={journey.id} />
          {/* מיקום ראשוני משורשר, כדי שכרטיסיות חדשות לא ייערמו זו על זו */}
          <input type="hidden" name="pos_x" value={40 + ((steps.length + 1) % 4) * 230} />
          <input type="hidden" name="pos_y" value={140 + Math.floor((steps.length + 1) / 4) * 130} />

          <label className="field-label">
            שם על הכרטיסייה
            <input name="label" className="input" placeholder="תזכורת ראשונה" maxLength={60} />
            <span className="text-xs font-normal text-[var(--subtle)]">
              לא חובה. בלעדיו מוצג שם התבנית.
            </span>
          </label>

          {journey.anchor === "booking" ? (
            <label className="field-label">
              מתי, יחסית לפגישה
              <select name="offset_minutes" className="input" defaultValue="-1440">
                {BEFORE_OPTIONS.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
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
                מהכרטיסייה שלפניה. 0 = מיד.
              </span>
            </label>
          )}

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

          <button type="submit" className="btn-primary self-start md:col-span-4">
            הוסף כרטיסייה
          </button>
        </form>

        {!templates.length && (
          <p className="mt-4 text-sm text-[var(--danger)]">
            אין עדיין תבניות במערכת. צרו אחת בעמוד תבניות הודעה — בלעדיה אי אפשר
            להוסיף כרטיסייה.
          </p>
        )}
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
                  {e.state === "active" &&
                    ` · ${stepLabelById.get(e.current_step_id ?? "") ?? "ממתין"}`}
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

/**
 * אפשרויות "לפני הפגישה", בדקות שליליות.
 *
 * רשימה סגורה ולא שדה חופשי: הערך הוא מספר שלילי, וזו בדיוק הצורה שקל
 * לטעות בה — "60" במקום "-60" היה הופך תזכורת לשעה *אחרי* הפגישה.
 */
const BEFORE_OPTIONS = [
  { minutes: -60, label: "שעה לפני" },
  { minutes: -120, label: "שעתיים לפני" },
  { minutes: -180, label: "שלוש שעות לפני" },
  { minutes: -960, label: "ערב לפני (16 שעות)" },
  { minutes: -1440, label: "יום לפני" },
  { minutes: -2880, label: "יומיים לפני" },
  { minutes: -10080, label: "שבוע לפני" },
  { minutes: 0, label: "במועד הפגישה" },
];
