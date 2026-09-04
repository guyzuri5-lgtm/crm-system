import { ActionForm } from "@/components/action-form";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { formatDateTime } from "@/lib/dates";
import { listPending } from "@/lib/webhook-inbox";
import {
  META_FORM_TARGET_TYPE_LABELS,
  WEBHOOK_SOURCE_LABELS,
  type MetaFormTarget,
  type WebhookSource,
} from "@/lib/supabase/database.types";
import {
  deleteFormTargetAction,
  dismissInboxAction,
  reprocessInboxAction,
  saveFormTargetAction,
} from "./actions";

/**
 * הגדרות ← טפסי מטא.
 *
 * המסך עונה על שאלה אחת שאין לה תשובה בשום מקום אחר במערכת: **לאיזה מוצר
 * שייך ליד שהגיע מטופס פרסום במטא.** ה-webhook מקבל מזהה טופס ותו לא, והשיוך
 * קיים רק בראש של מי שבנה את הקמפיין — כאן הוא נאמר בקול.
 *
 * למטה יושבת תיבת ה-webhooks: כל מה שנקלט ולא הצלחנו לעבד. זה לא לוג טכני
 * אלא רשימת משימות — כל שורה בה היא לקוחה או תשלום שממתינים.
 */
export default async function MetaFormsPage() {
  await verifyTeamMember();

  const db = supabaseAdmin();

  const [{ data: targets }, { data: events }, { data: courses }, pending] = await Promise.all([
    db.from("meta_form_targets").select("*").order("created_at", { ascending: false }),
    db.from("events").select("id, name").order("starts_at", { ascending: false }),
    db.from("courses").select("id, name").order("created_at", { ascending: false }),
    listPending(),
  ]);

  // שם היעד לכל שיוך. Map ולא חיפוש בתוך הלולאה — וגם כדי שיעד שנמחק יזוהה
  // כחסר ויוצג ככזה, במקום להיעלם בשקט משורת השיוך.
  const names = new Map<string, string>();
  for (const e of events ?? []) names.set(`event:${e.id}`, e.name);
  for (const c of courses ?? []) names.set(`course:${c.id}`, c.name);

  const rows = (targets ?? []) as MetaFormTarget[];
  const hasTargets = (events ?? []).length + (courses ?? []).length > 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">טפסי מטא</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מטא שולחת בליד את מזהה הטופס בלבד, בלי לומר לאיזה מוצר הוא שייך. השיוך כאן הוא מה
          שמכניס את הלקוחה לאירוע או לקורס הנכון. את המזהה מעתיקים מ־Meta Business Suite ←
          כלי לידים ← הטופס.
        </p>
      </div>

      <section className="card">
        <h2 className="mb-4 font-medium">שיוך חדש</h2>
        {hasTargets ? (
          <ActionForm
            action={saveFormTargetAction}
            resetOnSuccess
            className="flex flex-wrap items-end gap-3 text-sm"
          >
            <label className="field-label">
              מזהה הטופס
              <input
                name="form_id"
                required
                inputMode="numeric"
                maxLength={30}
                className="input"
                placeholder="1234567890123456"
              />
            </label>
            <label className="field-label flex-1 min-w-[12rem]">
              מפנה אל
              <select name="target" className="input" defaultValue="">
                <option value="" disabled>
                  בחירת אירוע או קורס
                </option>
                {(events ?? []).length > 0 && (
                  <optgroup label="אירועים">
                    {(events ?? []).map((e) => (
                      <option key={e.id} value={`event:${e.id}`}>
                        {e.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {(courses ?? []).length > 0 && (
                  <optgroup label="קורסים">
                    {(courses ?? []).map((c) => (
                      <option key={c.id} value={`course:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="field-label flex-1 min-w-[10rem]">
              כינוי (לא חובה)
              <input
                name="label"
                maxLength={120}
                className="input"
                placeholder="לדוגמה: קהל קר — ספטמבר"
              />
            </label>
            <button type="submit" className="btn-primary">
              שמור שיוך
            </button>
          </ActionForm>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            אין עדיין אירועים או קורסים לשייך אליהם. צרו קודם אירוע או קורס.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">אין עדיין שיוכים.</p>
        ) : (
          rows.map((row) => {
            const key = `${row.target_type}:${row.target_id}`;
            const name = names.get(key);
            return (
              <div key={row.form_id} className="card flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{row.form_id}</span>
                    <span className="text-[var(--subtle)]">←</span>
                    <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)]">
                      {META_FORM_TARGET_TYPE_LABELS[row.target_type]}
                    </span>
                    {/*
                      יעד שנמחק אינו נעלם מהרשימה אלא מוצג כשבור. שיוך יתום
                      ממשיך להיכשל בכל ליד שמגיע, ולכן הוא חייב להיראות.
                    */}
                    <span className={name ? "font-medium" : "font-medium text-[var(--danger)]"}>
                      {name ?? "היעד נמחק — יש לעדכן או למחוק את השיוך"}
                    </span>
                  </div>
                  {row.label && <span className="text-xs text-[var(--muted)]">{row.label}</span>}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <ActionForm action={saveFormTargetAction} className="flex items-end gap-2 text-sm">
                    <input type="hidden" name="form_id" value={row.form_id} />
                    <input type="hidden" name="label" value={row.label ?? ""} />
                    <select name="target" className="input" defaultValue={key}>
                      {(events ?? []).length > 0 && (
                        <optgroup label="אירועים">
                          {(events ?? []).map((e) => (
                            <option key={e.id} value={`event:${e.id}`}>
                              {e.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {(courses ?? []).length > 0 && (
                        <optgroup label="קורסים">
                          {(courses ?? []).map((c) => (
                            <option key={c.id} value={`course:${c.id}`}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button type="submit" className="btn-secondary">
                      עדכן
                    </button>
                  </ActionForm>

                  <ActionForm action={deleteFormTargetAction}>
                    <input type="hidden" name="form_id" value={row.form_id} />
                    <button type="submit" className="btn-danger">
                      מחק
                    </button>
                  </ActionForm>
                </div>
              </div>
            );
          })
        )}
      </section>

      <PendingInbox rows={pending} />
    </div>
  );
}

// ── תיבת ה-webhooks ────────────────────────────────────────────────────────

/**
 * מה שנקלט ולא עובד.
 *
 * מוצג כרשימת משימות ולא כלוג: לכל שורה יש הסבר בעברית ושני כפתורים —
 * לנסות שוב אחרי שתיקנת את הסיבה, או לסגור אותה כי טיפלת ידנית. ה-JSON הגולמי
 * מוסתר מאחורי "פרטים" כי הוא נחוץ רק כשההסבר לא הספיק.
 */
function PendingInbox({ rows }: { rows: Awaited<ReturnType<typeof listPending>> }) {
  if (rows.length === 0) {
    return (
      <section className="border-t border-[var(--border)] pt-6">
        <h2 className="font-medium">תיבת ה-webhooks</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          אין כרגע לידים או תשלומים שממתינים לטיפול.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-6">
      <div>
        <h2 className="font-medium text-[var(--danger)]">
          {rows.length} נקלטו ולא עובדו
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          כל שורה כאן היא לידה או תשלום שהגיעו למערכת ולא נקלטו עד הסוף. המידע נשמר במלואו —
          אחרי תיקון הסיבה אפשר לנסות שוב.
        </p>
      </div>

      {rows.map((row) => (
        <div key={row.id} className="card flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)]">
                {WEBHOOK_SOURCE_LABELS[row.source as WebhookSource] ?? row.source}
              </span>
              <span className="text-xs text-[var(--muted)]">{formatDateTime(row.created_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <ActionForm action={reprocessInboxAction}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="btn-secondary">
                  נסה שוב
                </button>
              </ActionForm>
              <ActionForm action={dismissInboxAction}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="btn-ghost">
                  סמן כטופל
                </button>
              </ActionForm>
            </div>
          </div>

          <p className="text-sm">{row.error ?? "טרם עובד"}</p>

          <details className="text-xs">
            <summary className="cursor-pointer text-[var(--muted)]">פרטים גולמיים</summary>
            <pre
              dir="ltr"
              className="mt-2 max-h-64 overflow-auto rounded-lg bg-[var(--background)] p-3 text-left"
            >
              {JSON.stringify(row.payload, null, 2)}
            </pre>
          </details>
        </div>
      ))}
    </section>
  );
}
