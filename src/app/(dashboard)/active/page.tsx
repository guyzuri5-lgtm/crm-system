import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { statusMap } from "@/lib/statuses";
import { statusColorClasses } from "@/lib/status-colors";
import { isWithin24HourWindow, windowRemainingMs } from "@/lib/whatsapp-cloud";
import type { Contact, InteractionType } from "@/lib/supabase/database.types";
import {
  sendWhatsAppReplyAction,
  sendWhatsAppTemplateAction,
} from "../contacts/[id]/actions";

export const dynamic = "force-dynamic";

/**
 * מה כל סוג אינטראקציה אומר בשורה אחת.
 *
 * ארבעת הראשונים הם מה שהלקוח יזם, וזו ההבחנה שעליה בנוי כל העמוד: מייל שיצא
 * ממך אל מישהו שמעולם לא ענה אינו סימן לעניין, הוא סימן לכך שניסית. שלושת
 * האחרונים מופיעים רק כשמדליקים את המתג.
 */
const ACTIVITY_LABELS: Record<InteractionType, string> = {
  whatsapp_in: "שלח הודעה",
  quiz_submitted: "מילא שאלון",
  course_lead: "השאיר פרטים לקורס",
  booking_created: "קבע פגישה",
  booking_cancelled: "ביטל פגישה",
  whatsapp_out: "נשלחה אליו הודעה",
  email_out: "נשלח אליו מייל",
  manual_note: "נרשמה הערה",
};

type ActivityRow = {
  contact_id: string;
  last_any_at: string | null;
  last_customer_at: string | null;
  last_inbound_at: string | null;
  last_inbound_text: string | null;
  last_customer_type: InteractionType | null;
  last_any_type: InteractionType | null;
  inbound_count: number;
};

/** "לפני 3 שעות" קריא יותר מחותמת זמן כשסורקים רשימה בעין. */
function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

export default async function ActivePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifyTeamMember();

  const params = await searchParams;
  const showAll = params.all === "1";

  const db = supabaseAdmin();

  // התצוגה מ-0012 מחזירה שורה לכל איש קשר שיש לו ולו אינטראקציה אחת — כלומר
  // מעטים מתוך מאות. לכן שולפים אותה קודם, ורק אז את אנשי הקשר עצמם.
  const query = db
    .from("contact_activity")
    .select("*")
    .order(showAll ? "last_any_at" : "last_customer_at", {
      ascending: false,
      nullsFirst: false,
    })
    .limit(200);

  const { data: activityRaw, error: activityError } = showAll
    ? await query
    : await query.not("last_customer_at", "is", null);

  if (activityError) {
    // 42P01 = הטבלה/תצוגה לא קיימת. ההודעה הגולמית של PostgREST לא רומזת מה חסר.
    if (activityError.code === "42P01" || activityError.code === "PGRST205") {
      throw new Error(
        "התצוגה contact_activity לא קיימת. יש להריץ את supabase/migrations/0012_contact_activity.sql ב-SQL editor של Supabase."
      );
    }
    throw activityError;
  }

  const activity = (activityRaw ?? []) as unknown as ActivityRow[];
  const contactIds = activity.map((row) => row.contact_id);

  const [{ data: contactsRaw }, statusesById, { data: templatesRaw }] = await Promise.all([
    contactIds.length
      ? db.from("contacts").select("*").in("id", contactIds)
      : Promise.resolve({ data: [] as Contact[] }),
    statusMap(),
    db
      .from("message_templates")
      .select("*")
      .eq("channel", "whatsapp")
      .not("meta_template_name", "is", null),
  ]);

  const contacts = new Map((contactsRaw ?? []).map((c) => [c.id, c as Contact]));
  const templates = templatesRaw ?? [];

  // סדר השורות נקבע בשאילתה; המפה משמשת רק לשליפה, ולכן עוברים על activity.
  const rows = activity
    .map((row) => ({ activity: row, contact: contacts.get(row.contact_id) }))
    .filter((row): row is { activity: ActivityRow; contact: Contact } => Boolean(row.contact));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">לקוחות פעילים</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {showAll
              ? "כל מי שיש איתו היסטוריה כלשהי, כולל פניות שיצאו ממך."
              : "מי שיזם משהו — שלח הודעה, מילא שאלון, קבע או ביטל פגישה."}
          </p>
        </div>
        <Link href={showAll ? "/active" : "/active?all=1"} className="btn-ghost">
          {showAll ? "רק מי שיזם" : "הצג גם פניות יוצאות"}
        </Link>
      </div>

      {!rows.length ? (
        <div className="card text-sm text-[var(--muted)]">
          {showAll
            ? "עדיין אין שום אינטראקציה במערכת."
            : "אף אחד עוד לא יזם פנייה. אנשי קשר שיובאו מאקסל ולא כתבו מעולם לא יופיעו כאן — הם נמצאים ב"}
          {!showAll && (
            <Link href="/contacts" className="underline">
              אנשי קשר
            </Link>
          )}
          {!showAll && "."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ activity: a, contact }) => {
            const openWindow = isWithin24HourWindow(contact.last_incoming_message_at);
            const hoursLeft = Math.floor(
              windowRemainingMs(contact.last_incoming_message_at) / 3_600_000
            );
            const status = statusesById.get(contact.status);
            const type = showAll ? a.last_any_type : a.last_customer_type;
            const at = showAll ? a.last_any_at : a.last_customer_at;
            const canSend = Boolean(contact.phone || contact.whatsapp_id);

            return (
              <div key={contact.id} className="card flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium hover:underline"
                    >
                      {contact.full_name || contact.phone || "ללא שם"}
                    </Link>
                    {contact.phone && (
                      <span className="text-xs text-[var(--subtle)]" dir="ltr">
                        {contact.phone}
                      </span>
                    )}
                    {status && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColorClasses(status.color)}`}
                      >
                        {status.name}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--subtle)]">
                    {type ? ACTIVITY_LABELS[type] : "—"} · {relativeTime(at)}
                  </span>
                </div>

                {/* ההודעה האחרונה שנכנסה ממנו — זה מה שאתה באמת סורק בעין. */}
                {a.last_inbound_text && (
                  <p className="line-clamp-2 rounded-lg bg-[var(--background)] px-3 py-2 text-sm leading-relaxed">
                    {a.last_inbound_text}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {openWindow ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      <span className="size-1.5 rounded-full bg-emerald-500" />
                      חלון פתוח — כ-{hoursLeft} שעות
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600 ring-1 ring-inset ring-stone-500/15">
                      <span className="size-1.5 rounded-full bg-stone-400" />
                      חלון סגור — רק תבנית
                    </span>
                  )}
                  {a.inbound_count > 0 && (
                    <span className="text-xs text-[var(--subtle)]">
                      {a.inbound_count} הודעות נכנסות
                    </span>
                  )}
                </div>

                {/*
                  details ולא רכיב לקוח: התיבה נפתחת בלחיצה בלי שורת JavaScript,
                  וכל השורות נשארות קלות גם כשיש הרבה מהן.
                */}
                {canSend && (
                  <details className="group">
                    <summary className="w-fit cursor-pointer text-sm font-medium text-[var(--primary)] hover:underline">
                      השב
                    </summary>
                    <div className="mt-3">
                      {openWindow ? (
                        <form action={sendWhatsAppReplyAction} className="flex flex-col gap-2">
                          <input type="hidden" name="contact_id" value={contact.id} />
                          <textarea
                            name="body"
                            rows={2}
                            required
                            placeholder="כתבו תשובה..."
                            className="input"
                          />
                          <button type="submit" className="btn-primary self-start">
                            שלח בוואטסאפ
                          </button>
                        </form>
                      ) : templates.length ? (
                        <form
                          action={sendWhatsAppTemplateAction}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="contact_id" value={contact.id} />
                          <label className="field-label flex-1">
                            תבנית מאושרת
                            <select name="template_id" required className="input">
                              {templates.map((t) => (
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
                          החלון סגור ואין תבנית מאושרת. צרו אחת ב
                          <Link href="/templates" className="underline">
                            תבניות הודעה
                          </Link>
                          .
                        </p>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
