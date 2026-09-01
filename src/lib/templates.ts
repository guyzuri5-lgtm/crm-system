import type { Contact, Booking } from "./supabase/database.types";

// Renders {{full_name}}-style placeholders in a message_templates.body/subject, per
// spec section 3. Deliberately an allow-list of contact fields rather than a generic
// property-access template engine, so a template can never accidentally interpolate
// something it shouldn't.
const TEMPLATE_FIELDS: Record<string, (contact: Contact) => string> = {
  full_name: (c) => c.full_name ?? "",
  first_name: (c) => (c.full_name ?? "").trim().split(/\s+/)[0] ?? "",
  phone: (c) => c.phone ?? "",
  email: (c) => c.email ?? "",
  status: (c) => c.status,
};

/**
 * שדות הפגישה, שנפתרים רק כשיש פגישה בהקשר.
 *
 * ── למה אזור הזמן של המוזמן ולא שלנו ──
 * ההודעה נקראת על ידי הלקוח, ו-"11:15" חייב להיות 11:15 *אצלו*. הפגישה
 * שומרת את אזור הזמן שהוא בחר בעת ההזמנה, וזה מה שמשמש כאן. הנפילה חזרה
 * לישראל היא לרשומות ישנות שנוצרו לפני שהשדה היה קיים.
 */
const BOOKING_FIELDS: Record<string, (booking: Booking) => string> = {
  booking_date: (b) => formatBooking(b, { dateStyle: "long" }),
  booking_time: (b) => formatBooking(b, { hour: "2-digit", minute: "2-digit" }),
  booking_day: (b) => formatBooking(b, { weekday: "long" }),
  booking_datetime: (b) =>
    `${formatBooking(b, { weekday: "long", day: "numeric", month: "long" })}, ${formatBooking(b, {
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  booking_link: (b) => b.google_meet_url ?? "",
};

function formatBooking(booking: Booking, options: Intl.DateTimeFormatOptions): string {
  return new Date(booking.starts_at).toLocaleString("he-IL", {
    ...options,
    timeZone: booking.invitee_timezone || "Asia/Jerusalem",
  });
}

/**
 * מציין של פגישה בתבנית שנשלחת בלי פגישה בהקשר היה מתרוקן בשקט, והלקוח היה
 * מקבל "תזכורת לפגישה ב־". עדיף להשאיר את המציין כפי שהוא: הודעה שנראית
 * שבורה נתפסת מיד, וריק לא נתפס בכלל.
 */
export function renderTemplate(
  text: string,
  contact: Contact,
  booking?: Booking | null
): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const contactField = TEMPLATE_FIELDS[key];
    if (contactField) return contactField(contact);

    const bookingField = BOOKING_FIELDS[key];
    if (bookingField) return booking ? bookingField(booking) : match;

    return match;
  });
}

/** המציינים הזמינים, לתצוגה בממשק. */
export const CONTACT_PLACEHOLDERS = Object.keys(TEMPLATE_FIELDS);
export const BOOKING_PLACEHOLDERS = Object.keys(BOOKING_FIELDS);
