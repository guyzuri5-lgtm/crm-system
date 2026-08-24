import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { MESSAGE_CHANNELS, CONTACT_STATUSES } from "@/lib/supabase/database.types";
import { createRuleAction, toggleRuleAction, deleteRuleAction } from "./actions";

export default async function RulesPage() {
  await verifyTeamMember();
  const db = supabaseAdmin();

  const [{ data: rules, error: rulesError }, { data: templates, error: templatesError }] =
    await Promise.all([
      db.from("automation_rules").select("*").order("created_at", { ascending: false }),
      db.from("message_templates").select("*").order("name"),
    ]);
  if (rulesError) throw rulesError;
  if (templatesError) throw templatesError;

  const templateById = new Map((templates ?? []).map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">כללי אוטומציה</h1>

      <section className="card">
        <h2 className="mb-4 font-medium">כלל חדש</h2>
        {!templates?.length ? (
          <p className="text-sm text-[var(--muted)]">
            צריך קודם ליצור לפחות תבנית הודעה אחת בעמוד{" "}
            <a href="/templates" className="text-[var(--primary)] underline">
              תבניות הודעה
            </a>
            .
          </p>
        ) : (
          <form action={createRuleAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field-label">
              סוג טריגר
              <select name="trigger_type" className="input" required>
                <option value="status_change">שינוי סטטוס</option>
                <option value="time_since_no_reply">זמן ללא מענה</option>
              </select>
            </label>
            <label className="field-label">
              ערוץ פעולה
              <select name="action_channel" className="input" required>
                {MESSAGE_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c === "email" ? "מייל" : "וואטסאפ"}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-label">
              סטטוס יציאה (רלוונטי רק ל&quot;שינוי סטטוס&quot;; ריק = כל סטטוס)
              <select name="from_status" className="input" defaultValue="">
                <option value="">כל סטטוס</option>
                {CONTACT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="field-label">
                ימים (&quot;זמן ללא מענה&quot; בלבד)
                <input name="days" type="number" min={1} className="input" />
              </label>
              <label className="field-label">
                סטטוס יעד (&quot;זמן ללא מענה&quot; בלבד)
                <select name="status" className="input" defaultValue="">
                  <option value="">בחר סטטוס</option>
                  {CONTACT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field-label md:col-span-2">
              תבנית
              <select name="action_template_id" className="input" required>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.channel === "email" ? "מייל" : "וואטסאפ"}] {t.name}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" className="btn-primary self-start md:col-span-2">
              צור כלל
            </button>
          </form>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {rules?.map((rule) => {
          const template = templateById.get(rule.action_template_id);
          const triggerValue = rule.trigger_value as Record<string, unknown>;
          return (
            <div key={rule.id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {rule.trigger_type === "status_change" ? "שינוי סטטוס" : "זמן ללא מענה"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      rule.active
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-stone-100 text-stone-500"
                    }`}
                  >
                    {rule.active ? "פעיל" : "כבוי"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {rule.trigger_type === "status_change"
                    ? `כשיוצאים מסטטוס: ${
                        triggerValue.from_status
                          ? String(triggerValue.from_status).replaceAll("_", " ")
                          : "כל סטטוס"
                      }`
                    : `${String(triggerValue.days ?? "?")} ימים בסטטוס ${String(
                        triggerValue.status ?? "?"
                      ).replaceAll("_", " ")}`}
                  {" ⟵ "}
                  שולח [{rule.action_channel === "email" ? "מייל" : "וואטסאפ"}]{" "}
                  {template?.name ?? "תבנית לא ידועה"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <form action={toggleRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <input type="hidden" name="active" value={String(rule.active)} />
                  <button type="submit" className="btn-secondary">
                    {rule.active ? "כבה" : "הפעל"}
                  </button>
                </form>
                <form action={deleteRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button type="submit" className="btn-danger">
                    מחיקה
                  </button>
                </form>
              </div>
            </div>
          );
        })}
        {!rules?.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין כללי אוטומציה</p>
        )}
      </section>
    </div>
  );
}
