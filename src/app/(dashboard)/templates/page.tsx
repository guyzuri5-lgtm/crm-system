import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { MESSAGE_CHANNELS } from "@/lib/supabase/database.types";
import { createTemplateAction, deleteTemplateAction } from "./actions";

export default async function TemplatesPage() {
  await verifyTeamMember();

  const { data: templates, error } = await supabaseAdmin()
    .from("message_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">תבניות הודעה</h1>

      <section className="card">
        <h2 className="mb-4 font-medium">תבנית חדשה</h2>
        <form action={createTemplateAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            ערוץ
            <select name="channel" className="input" required>
              {MESSAGE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c === "email" ? "מייל" : "וואטסאפ"}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            שם התבנית
            <input name="name" required className="input" />
          </label>
          <label className="field-label md:col-span-2">
            כותרת (למייל בלבד)
            <input name="subject" className="input" />
          </label>
          <label className="field-label md:col-span-2">
            {"תוכן — נתמכים: {{full_name}} {{first_name}} {{phone}} {{email}} {{status}}"}
            <textarea name="body" required rows={4} className="input" />
          </label>
          <label className="field-label md:col-span-2">
            manychat_template_id — ה-flow_ns של פלואו עם תבנית מאושרת (וואטסאפ מחוץ לחלון 24 שעות בלבד)
            <input name="manychat_template_id" className="input" />
          </label>
          <button type="submit" className="btn-primary self-start md:col-span-2">
            צור תבנית
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        {templates?.map((t) => (
          <div key={t.id} className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                  {t.channel === "email" ? "מייל" : "וואטסאפ"}
                </span>
              </div>
              <form action={deleteTemplateAction}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </form>
            </div>
            {t.subject && (
              <p className="mt-2 text-sm text-[var(--muted)]">כותרת: {t.subject}</p>
            )}
            <p className="mt-1 text-sm whitespace-pre-wrap">{t.body}</p>
            {t.manychat_template_id && (
              <p className="mt-2 text-xs text-[var(--subtle)]">flow_ns: {t.manychat_template_id}</p>
            )}
          </div>
        ))}
        {!templates?.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין תבניות</p>
        )}
      </section>
    </div>
  );
}
