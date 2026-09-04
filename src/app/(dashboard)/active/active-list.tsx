import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { statusMap } from "@/lib/statuses";
import { statusColorClasses, statusLabel } from "@/lib/status-colors";
import { formatDate } from "@/lib/dates";
import { isWithin24HourWindow, windowRemainingMs } from "@/lib/whatsapp-cloud";
import type { Contact, InteractionType } from "@/lib/supabase/database.types";
import { ContactRow, type ActiveRowData } from "./contact-row";
import { sendReplyAction } from "../contacts/[id]/actions";

/**
 * הרשימה שמאחורי שתי הלשוניות של "לקוחות פעילים".
 *
 * ההבחנה שעליה הכול בנוי: מה שהלקוח יזם מול מה שאנחנו יזמנו. ניוזלטר אחד
 * שיוצא למאות אנשים מייצר מאות שורות פעילות שאינן אומרות דבר על עניין —
 * הן אומרות ששלחנו. עד עכשיו שתי הקבוצות חלקו רשימה אחת עם מתג, והתוצאה
 * הייתה שהמאות הציפו את המעטים שבאמת כתבו. עכשיו זו לשונית נפרדת.
 *
 * שתי הלשוניות שואבות מאותה תצוגה (contact_activity) ונבדלות רק בתנאי
 * ובעמודת המיון, ולכן הן חולקות את הקוד הזה במלואו.
 */

const ACTIVITY_LABELS: Record<InteractionType, string> = {
  whatsapp_in: "שלח הודעה",
  quiz_submitted: "מילא שאלון",
  course_lead: "השאיר פרטים לקורס",
  event_registered: "נרשמה לאירוע",
  course_registered: "נרשמה לקורס",
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
  return formatDate(iso);
}

export type ActiveMode = "inbound" | "sent";

export async function ActiveList({ mode }: { mode: ActiveMode }) {
  const db = supabaseAdmin();

  // התצוגה מחזירה שורה לכל איש קשר שיש לו ולו אינטראקציה אחת — כלומר מעטים
  // מתוך מאות. לכן שולפים אותה קודם, ורק אז את אנשי הקשר עצמם.
  //
  // "נשלח אליהם" = יש היסטוריה, אבל אין בה שום דבר שהלקוח יזם. בדיוק הקבוצה
  // שהניוזלטר מייצר, ובדיוק זו שאין טעם לסרוק בעין כל בוקר.
  const base = db.from("contact_activity").select("*").limit(200);
  const query =
    mode === "inbound"
      ? base
          .not("last_customer_at", "is", null)
          .order("last_customer_at", { ascending: false, nullsFirst: false })
      : base
          .is("last_customer_at", null)
          .order("last_any_at", { ascending: false, nullsFirst: false });

  const { data: activityRaw, error: activityError } = await query;

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

  const [{ data: contactsRaw }, statusesByName, { data: templatesRaw }] = await Promise.all([
    contactIds.length
      ? db.from("contacts").select("*").in("id", contactIds)
      : Promise.resolve({ data: [] as Contact[] }),
    statusMap(),
    db
      .from("message_templates")
      .select("id, name")
      .eq("channel", "whatsapp")
      .not("meta_template_name", "is", null)
      .order("name"),
  ]);

  const contacts = new Map((contactsRaw ?? []).map((c) => [c.id, c as Contact]));
  const templates = (templatesRaw ?? []).map((t) => ({ id: t.id as string, name: t.name as string }));

  // סדר השורות נקבע בשאילתה; המפה משמשת רק לשליפה, ולכן עוברים על activity.
  const rows: ActiveRowData[] = activity.flatMap((a) => {
    const contact = contacts.get(a.contact_id);
    if (!contact) return [];

    const type = mode === "inbound" ? a.last_customer_type : a.last_any_type;
    const at = mode === "inbound" ? a.last_customer_at : a.last_any_at;
    const status = statusesByName.get(contact.status);

    return [
      {
        contactId: contact.id,
        name: contact.full_name || contact.phone || "ללא שם",
        phone: contact.phone,
        email: contact.email,
        statusName: status ? statusLabel(status.name) : null,
        statusClasses: statusColorClasses(status?.color),
        summaryLabel: type ? ACTIVITY_LABELS[type] : "—",
        timeLabel: relativeTime(at),
        preview: a.last_inbound_text,
        openWindow: isWithin24HourWindow(contact.last_incoming_message_at),
        hoursLeft: Math.floor(windowRemainingMs(contact.last_incoming_message_at) / 3_600_000),
        inboundCount: a.inbound_count,
        canSend: Boolean(contact.phone || contact.whatsapp_id),
        notes: contact.notes,
        createdAt: contact.created_at,
        lastIncomingAt: contact.last_incoming_message_at,
        whatsappId: contact.whatsapp_id,
      },
    ];
  });

  if (!rows.length) {
    return (
      <div className="card text-sm text-[var(--muted)]">
        {mode === "inbound" ? (
          <>
            אף אחד עוד לא יזם פנייה. אנשי קשר שיובאו מאקסל ולא כתבו מעולם לא יופיעו כאן — הם
            נמצאים ב<Link href="/contacts" className="underline">אנשי קשר</Link>.
          </>
        ) : (
          <>
            עוד לא יצאה הודעה לאף אחד שלא הגיב. ברגע שתשלח ניוזלטר או הודעה, מי שלא יענה יופיע
            כאן.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <ContactRow key={row.contactId} row={row} templates={templates} onSend={sendReplyAction} />
      ))}
    </div>
  );
}
