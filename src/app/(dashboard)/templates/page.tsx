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

          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 md:col-span-2">
            <p className="text-sm font-medium">שליחה מחוץ לחלון 24 השעות (וואטסאפ בלבד)</p>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-[var(--muted)]">
              ללקוח שלא כתב לנו ב-24 השעות האחרונות אפשר לשלוח רק תבנית שאושרה מראש
              אצל Meta. השדות כאן מקשרים את התבנית הזו לתבנית המאושרת שם. משאירים ריק
              כשהתבנית מיועדת לשימוש בתוך החלון בלבד.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="field-label">
                שם התבנית ב-Meta
                <input
                  name="meta_template_name"
                  className="input"
                  dir="ltr"
                  placeholder="appointment_reminder"
                  pattern="[a-z0-9_]+"
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  בדיוק כפי שהיא מופיעה ב-Meta: אותיות קטנות, ספרות וקו תחתון.
                </span>
              </label>

              <label className="field-label">
                שפת התבנית
                <input
                  name="meta_language_code"
                  defaultValue="he"
                  className="input"
                  dir="ltr"
                  placeholder="he"
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  חייב להתאים לשפה שאיתה אושרה. תבנית שאושרה ב-he ונשלחת כ-en_US נדחית.
                </span>
              </label>

              <label className="field-label md:col-span-2">
                {"מה ממלא את {{1}}, {{2}} ... — שורה לכל אחד, לפי הסדר"}
                <textarea
                  name="meta_variables"
                  rows={3}
                  className="input"
                  dir="ltr"
                  placeholder={"{{first_name}}\n{{status}}"}
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  {"אותם מציינים של התוכן למעלה. השורה הראשונה ממלאת את {{1}}, השנייה את {{2}}."}
                </span>
              </label>
            </div>
          </div>

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
            {t.channel === "whatsapp" && (
              <p className="mt-2 text-xs text-[var(--subtle)]">
                {t.meta_template_name ? (
                  <>
                    מאושרת ב-Meta:{" "}
                    <span dir="ltr" className="font-medium">
                      {t.meta_template_name} ({t.meta_language_code})
                    </span>
                    {t.meta_variables.length > 0 && <> · {t.meta_variables.length} משתנים</>}
                  </>
                ) : (
                  "ללא תבנית מאושרת — שמישה רק בתוך חלון 24 השעות"
                )}
              </p>
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
