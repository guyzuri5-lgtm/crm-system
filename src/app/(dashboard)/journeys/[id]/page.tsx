import { formatDate } from "@/lib/dates";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  JOURNEY_ENTRY_LABELS,
  JOURNEY_STATE_LABELS,
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
import { JourneySimulation } from "./simulation";

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

  // השגיאות נבדקות ולא נבלעות. הגרסה הקודמת לקחה רק את data, ומיון לפי עמודה
  // שנמחקה במיגרציה 0019 החזיר שגיאה ש-data שלה null — כלומר הדף הציג "אין
  // כרטיסיות" בזמן ששש מהן ישבו במסד. כישלון שקט גרוע מכישלון רועש.
  const [stepsRes, templatesRes, enrollmentsRes] = await Promise.all([
    db.from("journey_steps").select("*").eq("journey_id", id).order("created_at"),
    db.from("message_templates").select("*").order("name"),
    db
      .from("journey_enrollments")
      .select("*")
      .eq("journey_id", id)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  if (stepsRes.error) throw stepsRes.error;
  if (templatesRes.error) throw templatesRes.error;
  if (enrollmentsRes.error) throw enrollmentsRes.error;

  const { data: stepsRaw } = stepsRes;
  const { data: templatesRaw } = templatesRes;
  const { data: enrollmentsRaw } = enrollmentsRes;

  const steps = (stepsRaw ?? []) as JourneyStep[];

  const edgesRes = await db
    .from("journey_edges")
    .select("*")
    .eq("journey_id", id)
    .order("priority", { ascending: true });
  if (edgesRes.error) throw edgesRes.error;
  const edges = (edgesRes.data ?? []) as JourneyEdge[];
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

  // כמה אנשים עומדים בכל כרטיסייה. שאילתה נפרדת ולא ספירה מתוך enrollments
  // שלמעלה: זו מוגבלת ל-50 שורות לצורך הרשימה, וספירה ממנה הייתה משקרת
  // ברגע שיש יותר. שתי עמודות בלבד, ולכן היא זולה גם במסע גדול.
  const { data: standingRaw } = await db
    .from("journey_enrollments")
    .select("current_step_id")
    .eq("journey_id", id)
    .eq("state", "active");

  const standingByStep = new Map<string, number>();
  for (const row of standingRaw ?? []) {
    const key = row.current_step_id;
    if (key) standingByStep.set(key, (standingByStep.get(key) ?? 0) + 1);
  }
  const totalActive = (standingRaw ?? []).length;

  // שאר המסעות, לצד המשפך. מסע נערך כמעט תמיד מתוך השוואה לאחרים — "כמה
  // אנשים במסע הזה לעומת ההוא" — ועד עכשיו זה דרש לחזור לרשימה ולחזור.
  const [{ data: otherRaw }, { data: otherCountsRaw }] = await Promise.all([
    db.from("journeys").select("id, name, active").neq("id", id).order("name"),
    db.from("journey_enrollments").select("journey_id").eq("state", "active"),
  ]);
  const activeByJourney = new Map<string, number>();
  for (const row of otherCountsRaw ?? []) {
    activeByJourney.set(row.journey_id, (activeByJourney.get(row.journey_id) ?? 0) + 1);
  }
  const otherJourneys = (otherRaw ?? []) as { id: string; name: string; active: boolean }[];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/journeys" className="text-sm text-[var(--muted)] hover:underline">
            ← כל המסעות
          </Link>
          <h1 className="page-title mt-1">{journey.name}</h1>
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
        <div className="card border-[var(--ok)]/30 bg-[var(--ok-soft)] text-sm text-[var(--ok)]">
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
          bookingEntry={journey.entry_type === "booking"}
          entryLabel={
            JOURNEY_ENTRY_LABELS[journey.entry_type] +
            (journey.entry_type === "status" && journey.entry_value?.status
              ? `: ${journey.entry_value.status}`
              : "")
          }
          // typeof ולא !== null: לפני שמיגרציה 0031 רצה, select("*") לא מחזיר
          // את העמודה בכלל והערך הוא undefined — שאינו null, וכך היה עובר
          // את הבדיקה ומגיע ללוח כמיקום {undefined, undefined}.
          savedEntry={
            typeof journey.entry_pos_x === "number" && typeof journey.entry_pos_y === "number"
              ? { x: journey.entry_pos_x, y: journey.entry_pos_y }
              : null
          }
          nodes={steps.map((s) => ({
            id: s.id,
            x: s.pos_x,
            y: s.pos_y,
            label: s.label,
            templateId: s.template_id,
            templateName: templateById.get(s.template_id)?.name ?? "תבנית חסרה",
            channel: s.channel,
            waitDays: s.wait_days,
            relativeAtMinutes: s.relative_at_minutes,
            offsetMinutes: s.offset_minutes,
            timing: s.timing,
            dayOffset: s.day_offset,
            dayAtMinutes: s.day_at_minutes,
            // שורית מגוף התבנית, חתוכה. הכרטיסייה בלעדיה אומרת מתי ובאיזה
            // ערוץ אבל לא מה יוצא, וזו השאלה שבגללה פותחים מסע.
            preview: templateById.get(s.template_id)?.body?.slice(0, 120),
            standing: standingByStep.get(s.id) ?? 0,
          }))}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            channel: t.channel,
            body: t.body,
            metaTemplateName: t.meta_template_name,
            metaStatus: t.meta_status,
          }))}
          edges={edges.map((e) => ({
            id: e.id,
            fromId: e.from_step_id,
            toId: e.to_step_id,
            condition: e.condition,
          }))}
        />
      </section>

      {/* ── איפה כולם עומדים ───────────────────────────────────────────── */}
      {/*
        הלוח מראה את המבנה; המשפך מראה מה קורה בו בפועל. שני מסעות יכולים
        להיראות זהים על הלוח ולהתנהג הפוך לגמרי, וההפרש בין שלב לשלב הוא
        מה שמגלה איפה אנשים נתקעים.
      */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {totalActive > 0 && (
        <section className="card flex flex-col p-0">
          <div className="card-h">
            <h2>איפה כולם עומדים</h2>
            <span className="flex-1" />
            <span className="pill">{totalActive} פעילים</span>
          </div>
          <div className="card-b flex flex-col gap-2.5">
            {steps.map((step) => {
              const n = standingByStep.get(step.id) ?? 0;
              return (
                <div key={step.id} className="fn-row">
                  <span className="fn-label truncate">{stepLabelById.get(step.id)}</span>
                  <span className="fn-track">
                    <i
                      style={{
                        width: `${totalActive ? Math.round((n / totalActive) * 100) : 0}%`,
                        backgroundColor: "var(--nav-purple)",
                      }}
                    />
                  </span>
                  <span className="fn-value">{n}</span>
                </div>
              );
            })}
          </div>
          <div className="card-f">
            נספרים רק צירופים פעילים. מי שסיים, נעצר או ענה כבר אינו כאן.
          </div>
        </section>
      )}

      {otherJourneys.length > 0 && (
        <section className="card flex flex-col p-0">
          <div className="card-h">
            <h2>מסעות אחרים</h2>
            <span className="flex-1" />
            <Link href="/journeys" className="btn-ghost text-xs">
              לרשימה
            </Link>
          </div>
          <div className="card-b flex flex-col gap-2">
            {otherJourneys.map((other) => (
              <Link
                key={other.id}
                href={`/journeys/${other.id}`}
                className={`group-row ${other.active ? "" : "opacity-65"}`}
              >
                <b className="min-w-0 flex-1 truncate font-semibold">{other.name}</b>
                <span
                  className="pill"
                  style={
                    other.active
                      ? ({ "--pill-color": "var(--ok)", "--pill-bg": "var(--ok-soft)" } as CSSProperties)
                      : undefined
                  }
                >
                  {other.active ? "פעיל" : "כבוי"}
                </span>
                <span className="data text-[11px] text-[var(--subtle)]">
                  {activeByJourney.get(other.id) ?? 0}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      </div>

      {/* ── מסע לדוגמה: הבדיקה האחרונה לפני שמדליקים ─────────────────── */}
      <JourneySimulation
        steps={steps}
        edges={edges}
        templates={templates}
        bookingEntry={journey.entry_type === "booking"}
      />

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
                      הבא: {formatDate(e.next_run_at)}
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
