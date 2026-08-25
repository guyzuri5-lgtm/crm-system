import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { isWithin24HourWindow } from "@/lib/manychat";
import { listStatuses, statusMap } from "@/lib/statuses";
import { editableFields, readFieldValue } from "@/lib/fields";
import { statusLabel } from "@/lib/status-colors";
import { StatusBadge } from "@/components/status-badge";
import { QuizResult, type QuizSubmissionView } from "@/components/quiz-result";
import {
  changeStatusAction,
  updateContactFieldsAction,
  updateNotesAction,
  addManualNoteAction,
  sendWhatsAppReplyAction,
  sendWhatsAppTemplateAction,
} from "./actions";

const INTERACTION_LABELS: Record<string, string> = {
  manychat_in: "וואטסאפ ← נכנס",
  manychat_out: "וואטסאפ → יוצא",
  email_out: "מייל → יוצא",
  manual_note: "הערה ידנית",
  quiz_submitted: "שאלון צ'אקרות",
  booking_created: "נקבעה פגישה",
  booking_cancelled: "בוטלה פגישה",
};

const INTERACTION_DOT: Record<string, string> = {
  manychat_in: "bg-emerald-500",
  manychat_out: "bg-[var(--primary)]",
  email_out: "bg-blue-500",
  manual_note: "bg-stone-400",
  quiz_submitted: "bg-violet-500",
  booking_created: "bg-teal-500",
  booking_cancelled: "bg-rose-400",
};

export default async function ContactDetailPage(props: PageProps<"/contacts/[id]">) {
  await verifyTeamMember();
  const { id } = await props.params;

  const [statuses, statusesByName, allEditable] = await Promise.all([
    listStatuses(),
    statusMap(),
    editableFields(),
  ]);
  // סטטוס והערות מוצגים בפקדים ייעודיים משלהם במקום אחר בעמוד
  const editableDetailFields = allEditable.filter(
    (f) => f.key !== "status" && f.key !== "notes"
  );

  const db = supabaseAdmin();
  const [
    { data: contact, error },
    { data: interactions, error: interactionsError },
    { data: quizzes, error: quizError },
    { data: whatsappTemplates, error: templatesError },
  ] = await Promise.all([
    db.from("contacts").select("*").eq("id", id).maybeSingle(),
    db
      .from("interactions")
      .select("*")
      .eq("contact_id", id)
      .order("created_at", { ascending: false }),
    // המילוי האחרון קודם; אדם יכול למלא את השאלון יותר מפעם אחת
    db
      .from("quiz_submissions")
      .select("*")
      .eq("contact_id", id)
      .order("submitted_at", { ascending: false }),
    db.from("message_templates").select("*").eq("channel", "whatsapp").order("name"),
  ]);

  if (error) throw error;
  if (interactionsError) throw interactionsError;
  // PGRST205 = table not found — the quiz_submissions migration (0002_quiz.sql) is on
  // hold for now. Don't let an optional, not-yet-set-up feature take down the whole
  // contact page; treat it as "no quiz data yet" instead. Any other error still throws.
  if (quizError && quizError.code !== "PGRST205") throw quizError;
  if (templatesError) throw templatesError;
  if (!contact) notFound();

  const withinWindow = isWithin24HourWindow(contact.last_incoming_message_at);
  const sendableTemplates = (whatsappTemplates ?? []).filter((t) => t.manychat_template_id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/contacts"
            className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            ← חזרה לרשימה
          </Link>
          <h1 className="mt-1 text-xl font-semibold">
            {contact.full_name ?? "איש קשר ללא שם"}
          </h1>
        </div>
        <StatusBadge status={contact.status} color={statusesByName.get(contact.status)?.color} />
      </div>

      {(quizzes ?? []).length > 0 && (
        <section className="flex flex-col gap-4">
          {(quizzes as QuizSubmissionView[]).map((q) => (
            <QuizResult key={q.id} submission={q} />
          ))}
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card flex flex-col gap-4">
          <h2 className="font-medium">פרטים</h2>

          {/* השדות והסדר שלהם מגיעים מ-contact_fields (עמוד /fields), כולל
              שדות מותאמים. סטטוס והערות לא כאן — יש להם פקדים משלהם. */}
          <form action={updateContactFieldsAction} className="flex flex-col gap-3 text-sm">
            <input type="hidden" name="contact_id" value={contact.id} />
            {editableDetailFields.map((field) => (
              <label key={field.key} className="field-label">
                {field.label}
                {field.input_type === "longtext" ? (
                  <textarea
                    name={`field_${field.key}`}
                    defaultValue={readFieldValue(contact, field) ?? ""}
                    rows={3}
                    className="input"
                  />
                ) : (
                  <input
                    name={`field_${field.key}`}
                    type={
                      field.input_type === "email"
                        ? "email"
                        : field.input_type === "number"
                          ? "number"
                          : field.input_type === "date"
                            ? "date"
                            : field.input_type === "url"
                              ? "url"
                              : "text"
                    }
                    defaultValue={readFieldValue(contact, field) ?? ""}
                    placeholder={field.key === "tags" ? "מופרדות בפסיק" : undefined}
                    className="input"
                  />
                )}
              </label>
            ))}
            <button type="submit" className="btn-secondary self-start">
              שמור פרטים
            </button>
          </form>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 border-t border-[var(--border)] pt-4 text-sm">
            <dt className="text-[var(--muted)]">הודעה נכנסת אחרונה</dt>
            <dd>
              {contact.last_incoming_message_at
                ? new Date(contact.last_incoming_message_at).toLocaleString("he-IL")
                : "—"}
            </dd>
            <dt className="text-[var(--muted)]">מזהה ManyChat</dt>
            <dd className="truncate">{contact.manychat_subscriber_id ?? "—"}</dd>
            <dt className="text-[var(--muted)]">נוצר</dt>
            <dd>{new Date(contact.created_at).toLocaleString("he-IL")}</dd>
          </dl>

          <form
            action={changeStatusAction}
            className="flex items-end gap-2 border-t border-[var(--border)] pt-4"
          >
            <input type="hidden" name="contact_id" value={contact.id} />
            <label className="field-label flex-1">
              עדכון סטטוס
              <select name="status" defaultValue={contact.status} className="input">
                {statuses.map((s) => (
                  <option key={s.id} value={s.name}>
                    {statusLabel(s.name)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-secondary">
              עדכן
            </button>
          </form>
        </div>

        <div className="card flex flex-col gap-2">
          <h2 className="font-medium">הערות</h2>
          <form action={updateNotesAction} className="flex flex-col gap-3">
            <input type="hidden" name="contact_id" value={contact.id} />
            <textarea
              name="notes"
              defaultValue={contact.notes ?? ""}
              rows={6}
              className="input"
              placeholder="הערות פנימיות על איש הקשר..."
            />
            <button type="submit" className="btn-secondary self-start">
              שמור הערות
            </button>
          </form>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">לוג אינטראקציות</h2>

        <form action={addManualNoteAction} className="flex gap-2">
          <input type="hidden" name="contact_id" value={contact.id} />
          <input
            name="content"
            placeholder="הוסיפו הערה ללוג (לדוגמה: 'דיברנו בטלפון')"
            className="input flex-1"
          />
          <button type="submit" className="btn-secondary shrink-0">
            הוסף ללוג
          </button>
        </form>

        <ul className="flex flex-col gap-2">
          {interactions?.map((interaction) => (
            <li key={interaction.id} className="card py-3">
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${INTERACTION_DOT[interaction.type] ?? "bg-stone-400"}`}
                  />
                  {INTERACTION_LABELS[interaction.type] ?? interaction.type}
                </span>
                <span>{new Date(interaction.created_at).toLocaleString("he-IL")}</span>
              </div>
              {interaction.content && (
                <p className="mt-1.5 text-sm whitespace-pre-wrap">{interaction.content}</p>
              )}
            </li>
          ))}
          {!interactions?.length && (
            <p className="px-1 text-sm text-[var(--subtle)]">אין עדיין אינטראקציות</p>
          )}
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-3 font-medium">שליחת הודעת וואטסאפ</h2>
        {!contact.manychat_subscriber_id ? (
          <p className="text-sm text-[var(--muted)]">
            אין עדיין מזהה ManyChat לאיש הקשר הזה — עוד לא התקבלה ממנו הודעה דרך ה-webhook, אז אי אפשר לשלוח.
          </p>
        ) : withinWindow ? (
          <form action={sendWhatsAppReplyAction} className="flex flex-col gap-3">
            <input type="hidden" name="contact_id" value={contact.id} />
            <textarea
              name="body"
              rows={3}
              required
              placeholder="כתבו הודעה לשליחה בוואטסאפ..."
              className="input"
            />
            <button type="submit" className="btn-primary self-start">
              שלח בוואטסאפ
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--muted)]">
              איש הקשר מחוץ לחלון 24 השעות — וואטסאפ מאפשר לשלוח רק הודעת תבנית מאושרת, לא טקסט חופשי.
            </p>
            {sendableTemplates.length ? (
              <form action={sendWhatsAppTemplateAction} className="flex items-end gap-2">
                <input type="hidden" name="contact_id" value={contact.id} />
                <label className="field-label flex-1">
                  תבנית מאושרת
                  <select name="template_id" required className="input">
                    {sendableTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn-primary">
                  שלח תבנית
                </button>
              </form>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                אין עדיין תבניות וואטסאפ עם flow_ns מוגדר — צרו אחת בעמוד{" "}
                <Link href="/templates" className="text-[var(--primary)] underline">
                  תבניות הודעה
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
