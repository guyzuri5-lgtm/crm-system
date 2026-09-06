import "server-only";

import {
  buildIcs,
  googleCalendarUrl,
  type CalendarEntry,
} from "@/lib/calendar-links";
import { appUrl } from "./create";
import {
  BOOKING_LOCATION_LABELS,
  type Booking,
  type BookingEventType,
} from "@/lib/supabase/database.types";

/**
 * "הוספה ליומן" עבור פגישה שנקבעה.
 *
 * ── למה זה נחוץ בכלל, אם גוגל כבר שולחת הזמנה ──
 * createCalendarEvent מוסיף את הלקוח כ-attendee עם sendUpdates: "all", וגוגל
 * אכן שולחת לו הזמנה ליומן. אבל זה עובד רק אם הכתובת שלו היא חשבון גוגל,
 * ההזמנה לא נבלעה בספאם, והוא בכלל שם לב אליה. קישור מפורש בעמוד האישור
 * ובמייל שלנו אינו תלוי באף אחד משלושת אלה.
 *
 * ── מה נכנס לאירוע ──
 * המיקום נגזר מסוג הפגישה: בשיחת וידאו זה קישור ה-Meet עצמו (שם היומנים
 * מציגים כפתור הצטרפות), בפגישה פרונטלית הכתובת, ובשיחת טלפון רק התיאור.
 * הקישור לביטול נכנס לתיאור — זה המקום שבו הלקוח יחפש אותו בעוד שבוע,
 * ולא במייל שירד בינתיים למטה בתיבה.
 */
export function bookingCalendarEntry(
  booking: Booking,
  eventType: BookingEventType,
  hostName: string | null
): CalendarEntry {
  // host_name ולא brand_name: brand_name הוא כותרת דף ההזמנה ("קביעת פגישה"),
  // ובלי ההבחנה הזו האירוע ביומן נקרא "שיחת היכרות עם קביעת פגישה".
  // כשאין שם מארח, הכותרת נשארת שם סוג הפגישה בלבד.
  const withWhom = hostName?.trim() ? ` עם ${hostName.trim()}` : "";

  const location =
    eventType.location === "google_meet"
      ? booking.google_meet_url
      : eventType.location === "in_person"
        ? eventType.location_details
        : null;

  const details = [
    eventType.description?.trim(),
    eventType.location === "google_meet" && booking.google_meet_url
      ? `קישור לשיחה: ${booking.google_meet_url}`
      : null,
    eventType.location === "phone"
      ? `${BOOKING_LOCATION_LABELS.phone}${eventType.location_details ? ` · ${eventType.location_details}` : ""}`
      : null,
    `לביטול או שינוי מועד: ${appUrl()}/book/cancel/${booking.cancel_token}`,
  ].filter(Boolean);

  return {
    // "booking-" כדי ששני מזהים מטבלאות שונות לא יתנגשו ביומן של אותו אדם,
    // ויציב לאורך זמן כדי שהורדה חוזרת תעדכן ולא תכפיל.
    uid: `booking-${booking.id}@crm`,
    title: `${eventType.name}${withWhom}`,
    start: new Date(booking.starts_at),
    end: new Date(booking.ends_at),
    location,
    description: details.join("\n"),
  };
}

/** קובץ יומן לפגישה — לאאוטלוק, לאפל ולכל מי שאינו גוגל. */
export function bookingIcs(
  booking: Booking,
  eventType: BookingEventType,
  hostName: string | null
): string {
  return buildIcs(bookingCalendarEntry(booking, eventType, hostName));
}

/** קישור "הוספה ליומן Google" לפגישה. */
export function bookingGoogleCalendarUrl(
  booking: Booking,
  eventType: BookingEventType,
  hostName: string | null
): string {
  return googleCalendarUrl(bookingCalendarEntry(booking, eventType, hostName));
}

/**
 * הכתובת הציבורית שממנה מורידים את הקובץ.
 *
 * המפתח הוא cancel_token ולא מזהה הפגישה, מאותו נימוק שבגללו הוא קיים:
 * הוא סוד שנשלח רק למוזמן, ובלעדיו אי אפשר לנחש פגישה של מישהו אחר. מזהה
 * הפגישה מופיע בכתובות פנימיות ואינו מיועד לשמש כמפתח ציבורי.
 */
export function bookingIcsUrl(booking: Booking): string {
  return `${appUrl()}/api/booking/ics/${booking.cancel_token}`;
}
