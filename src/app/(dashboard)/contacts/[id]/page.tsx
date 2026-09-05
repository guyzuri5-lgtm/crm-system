import { formatDateTime } from "@/lib/dates";
import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { isWithin24HourWindow, windowRemainingMs } from "@/lib/whatsapp-cloud";
import { listStatuses, statusMap } from "@/lib/statuses";
import { editableFields, readFieldValue } from "@/lib/fields";
import { statusLabel } from "@/lib/status-colors";
import { StatusBadge } from "@/components/status-badge";
import { QuizResult, type QuizSubmissionView } from "@/components/quiz-result";
import { Conversation } from "@/components/conversation";
import { ReplyBox } from "@/components/reply-box";
import { ScrollToBottom } from "@/components/scroll-to-bottom";
import { WindowMeter } from "@/components/window-meter";
import { Avatar } from "@/components/avatar";
import {
  changeStatusAction,
  updateContactFieldsAction,
  updateNotesAction,
  addManualNoteAction,
  sendReplyAction,
} from "./actions";

/**
 * כרטיס הלקוח, בפריסה הפוכה מזו שהייתה כאן.
 *
 * קודם הפרטים תפסו חצי מסך והשיחה נדחקה לתחתית העמוד. אבל מה שקוראים בפועל
 * כשנכנסים לכרטיס זו ההתכתבות — הפרטים נבדקים פעם אחת ואז נשכחים. לכן השיחה
 * היא העמודה הרחבה, והפרטים, השאלון וההערות יושבים לצידה.
 */

function ChatIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </svg>
  );
}

function glyphStyle(color: string, soft: string): CSSProperties {
  return { "--glyph-color": color, "--glyph-bg": soft } as CSSProperties;
}

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

  // ה-wa_id נגזר מהטלפון, ולכן אפשר לפנות גם למי שמעולם לא כתב.
  const canSendWhatsApp = Boolean(contact.whatsapp_id || contact.phone);

  // הכלל היחיד שקובע מה מותר לשלוח. מחוץ לחלון Meta מקבלת *רק* תבנית שאושרה
  // מראש, ולכן רק תבניות עם meta_template_name שמישות שם.
  const openWindow = isWithin24HourWindow(contact.last_incoming_message_at);
  const hoursLeft = Math.floor(windowRemainingMs(contact.last_incoming_message_at) / 3_600_000);
  const approvedTemplates = (whatsappTemplates ?? []).filter((t) => t.meta_template_name);

  const name = contact.full_name ?? "איש קשר ללא שם";
  const messageCount = interactions?.length ?? 0;
  const contactLine = [contact.phone, contact.email].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/contacts"
        className="w-fit text-[12.5px] text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
      >
        ← חזרה לרשימה
      </Link>

      <div className="h-page">
        <div className="flex items-center gap-3">
          <Avatar name={name} className="size-[42px] rounded-[13px] text-[15px]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1>{name}</h1>
              <StatusBadge
                status={contact.status}
                color={statusesByName.get(contact.status)?.color}
              />
              <WindowMeter openWindow={openWindow} hoursLeft={hoursLeft} />
            </div>
            {contactLine && (
              <p className="data mt-1 truncate text-[12px] text-[var(--subtle)]" dir="ltr">
                {contactLine}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* השיחה רחבה, הפרטים לצידה. ב-RTL העמודה הראשונה היא הימנית, ולכן
          השיחה נופלת בדיוק במקום שהעין מתחילה בו. */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="card flex flex-col p-0">
          <div className="card-h">
            <span className="glyph" style={glyphStyle("var(--ok)", "var(--ok-soft)")}>
              <ChatIcon />
            </span>
            <h2>שיחה</h2>
            <span className="flex-1" />
            {messageCount > 0 && <span className="pill">{messageCount} הודעות</span>}
          </div>

          <div className="card-b flex flex-col gap-3">
            <ScrollToBottom
              watch={messageCount}
              className="max-h-[32rem] overflow-y-auto rounded-xl bg-[var(--background)] p-3"
            >
              <Conversation messages={interactions ?? []} />
            </ScrollToBottom>

            <ReplyBox
              contactId={contact.id}
              canSend={canSendWhatsApp}
              openWindow={openWindow}
              hoursLeft={hoursLeft}
              templates={approvedTemplates.map((t) => ({ id: t.id, name: t.name }))}
              onSend={sendReplyAction}
            />

            {/*
              הערה ידנית נרשמת כאינטראקציה ולכן היא מופיעה בשיחה עצמה, כשורת
              מערכת באמצע ולא כבועה — היא לא נשלחה לאף אחד.
            */}
            <ActionForm
              action={addManualNoteAction}
              resetOnSuccess
              className="flex gap-2 border-t border-[var(--border)] pt-3"
            >
              <input type="hidden" name="contact_id" value={contact.id} />
              <input
                name="content"
                placeholder="הערה פנימית לשיחה (לדוגמה: ״דיברנו בטלפון״)"
                className="input flex-1"
              />
              <button type="submit" className="btn-secondary shrink-0">
                הוסף הערה
              </button>
            </ActionForm>
          </div>
        </section>

        <div className="flex flex-col gap-4">
          <section className="card flex flex-col p-0">
            <div className="card-h">
              <h2>פרטים</h2>
            </div>

            <div className="card-b flex flex-col gap-4">
              {/* השדות והסדר שלהם מגיעים מ-contact_fields (עמוד /fields), כולל
                  שדות מותאמים. סטטוס והערות לא כאן — יש להם פקדים משלהם. */}
              <ActionForm action={updateContactFieldsAction} className="flex flex-col gap-3 text-sm">
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
              </ActionForm>

              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 border-t border-[var(--border)] pt-4 text-[12.5px]">
                <dt className="text-[var(--muted)]">הודעה נכנסת אחרונה</dt>
                <dd className="data">
                  {contact.last_incoming_message_at
                    ? formatDateTime(contact.last_incoming_message_at)
                    : "—"}
                </dd>
                <dt className="text-[var(--muted)]">מזהה וואטסאפ</dt>
                <dd className="data truncate" dir="ltr">
                  {contact.whatsapp_id ?? "—"}
                </dd>
                <dt className="text-[var(--muted)]">נוצר</dt>
                <dd className="data">{formatDateTime(contact.created_at)}</dd>
              </dl>

              <ActionForm
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
              </ActionForm>
            </div>
          </section>

          {/* השאלון הוא הסיבה שיודעים מה להגיד לו, ולכן הוא יושב גבוה — מעל
              ההערות ומתחת לפרטים, ולא בתחתית העמוד כמו קודם. */}
          {(quizzes ?? []).length > 0 &&
            (quizzes as QuizSubmissionView[]).map((q) => <QuizResult key={q.id} submission={q} />)}

          <section className="card flex flex-col p-0">
            <div className="card-h">
              <h2>הערות פנימיות</h2>
            </div>
            <div className="card-b">
              <ActionForm action={updateNotesAction} className="flex flex-col gap-3">
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
              </ActionForm>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
