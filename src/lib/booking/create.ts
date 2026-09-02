import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isCalendarConfigured,
} from "@/lib/google-calendar";
import { normalizePhone } from "@/lib/quiz";
import {
  BOOKING_LOCATION_LABELS,
  type Booking,
  type BookingEventType,
  type Contact,
} from "@/lib/supabase/database.types";
import { buildCancellationEmail, buildConfirmationEmail } from "./email";
import { getBookingSettings } from "./data";
import { getAvailableSlots } from "./slots";
import { formatDateTime } from "./timezone";

/**
 * הזרימה המלאה של "נסגרה פגישה". סדר הפעולות כאן אינו שרירותי — ראו ההערות
 * בגוף הפונקציה, במיוחד למה שורת ה-booking נכתבת *לפני* האירוע ביומן.
 */

/** כתובת הבסיס הציבורית, לבניית קישור הביטול שנשלח במייל. */
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  // Vercel מזריק את זה אוטומטית בכל דיפלוי, בלי הסכמה.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export interface CreateBookingInput {
  eventType: BookingEventType;
  /** שעת ההתחלה שהלקוח בחר, כ-ISO */
  startIso: string;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  /** אזור הזמן של הדפדפן של הלקוח, לתצוגה בלבד */
  inviteeTimezone?: string | null;
}

export type CreateBookingResult =
  | { ok: true; booking: Booking; meetUrl: string | null; calendarSynced: boolean }
  | { ok: false; error: string; code: "slot_taken" | "invalid_slot" | "calendar_unavailable" | "failed" };

/**
 * איתור או יצירה של כרטיס הלקוח.
 *
 * סדר החיפוש: קודם טלפון (עמודה עם אילוץ יחידות — התאמה שם היא ודאית), ואחריו
 * מייל. השדות הקיימים לא נדרסים: מי שכבר רשום בשם מלא לא יאבד אותו בגלל
 * שהקליד רק שם פרטי בטופס. משלימים רק מה שחסר.
 */
async function upsertContact(input: {
  name: string;
  email: string;
  phone: string | null;
}): Promise<Contact | null> {
  const db = supabaseAdmin();
  const email = input.email.trim().toLowerCase();

  let existing: Contact | null = null;

  if (input.phone) {
    const { data } = await db.from("contacts").select("*").eq("phone", input.phone).maybeSingle();
    existing = data ?? null;
  }
  if (!existing) {
    const { data } = await db
      .from("contacts")
      .select("*")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    existing = data ?? null;
  }

  if (existing) {
    const patch: Partial<Contact> = {};
    if (!existing.full_name && input.name) patch.full_name = input.name;
    if (!existing.email) patch.email = email;
    // טלפון נכתב רק אם אין, כי הוא מפתח יחיד: דריסה עלולה להתנגש בכרטיס אחר.
    if (!existing.phone && input.phone) patch.phone = input.phone;

    if (Object.keys(patch).length === 0) return existing;

    const { data, error } = await db
      .from("contacts")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    // התנגשות על הטלפון (23505) אינה סיבה להפיל קביעת פגישה — נשארים עם
    // הכרטיס כפי שהוא.
    if (error) return existing;
    return data;
  }

  const { data, error } = await db
    .from("contacts")
    .insert({
      full_name: input.name,
      email,
      phone: input.phone,
      source: "זימון פגישה",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[booking] failed to create contact:", error.message);
    return null;
  }
  return data;
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const db = supabaseAdmin();
  const settings = await getBookingSettings();
  const { eventType } = input;

  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "מועד לא תקין", code: "invalid_slot" };
  const end = new Date(start.getTime() + eventType.duration_minutes * 60_000);

  // ── 1. אימות מחדש של הסלוט ────────────────────────────────────────────
  // הלקוח שלח שעה שהוא ראה לפני דקה או לפני שעה. אסור לסמוך עליה: היא עברה
  // דרך הדפדפן, והיומן יכול היה להתמלא בינתיים. מחשבים מחדש את הזמינות של
  // אותו יום ובודקים שהשעה עדיין ברשימה.
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);

  let stillAvailable: boolean;
  try {
    const availability = await getAvailableSlots({
      eventType,
      fromDateKey: dateKey,
      toDateKey: dateKey,
    });
    stillAvailable = availability.days.some((day) =>
      day.slots.includes(start.toISOString())
    );
  } catch (error) {
    if (error instanceof Error && error.message === "calendar_unavailable") {
      return {
        ok: false,
        error: "לא הצלחנו לאמת מול היומן כרגע. נסו שוב בעוד רגע.",
        code: "calendar_unavailable",
      };
    }
    throw error;
  }

  if (!stillAvailable) {
    return { ok: false, error: "השעה הזו כבר לא פנויה. בחרו מועד אחר.", code: "slot_taken" };
  }

  // ── 2. כרטיס הלקוח ────────────────────────────────────────────────────
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const contact = await upsertContact({ name: input.name, email: input.email, phone });

  // ── 3. שמירת הפגישה — לפני היומן, בכוונה ─────────────────────────────
  // אילוץ ההדרה על הטבלה (ראו 0005_booking.sql) הוא הבורר האטומי היחיד בין
  // שני אנשים שלחצו על אותה שעה בו-זמנית. אם היינו יוצרים קודם את האירוע
  // ביומן, המפסיד במרוץ היה משאיר אחריו אירוע יתום שצריך למחוק.
  const { data: booking, error: bookingError } = await db
    .from("bookings")
    .insert({
      event_type_id: eventType.id,
      contact_id: contact?.id ?? null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      invitee_name: input.name.trim(),
      invitee_email: input.email.trim().toLowerCase(),
      invitee_phone: phone,
      invitee_notes: input.notes?.trim() || null,
      invitee_timezone: input.inviteeTimezone || settings.timezone,
    })
    .select("*")
    .single();

  if (bookingError || !booking) {
    // 23P01 = exclusion_violation, כלומר מישהו הקדים אותנו באותן שניות.
    if (bookingError?.code === "23P01") {
      return { ok: false, error: "השעה הזו נתפסה הרגע. בחרו מועד אחר.", code: "slot_taken" };
    }
    console.error("[booking] insert failed:", bookingError?.message);
    return { ok: false, error: "שמירת הפגישה נכשלה", code: "failed" };
  }

  // ── 4. האירוע ביומן ───────────────────────────────────────────────────
  // כשל כאן *לא* מבטל את הפגישה: השעה כבר שמורה ולא תוצע לאף אחד אחר, ואיבוד
  // הפגישה היה גרוע יותר מפגישה שלא סונכרנה. הדשבורד מסמן פגישה בלי
  // google_event_id כ"לא סונכרנה ליומן" כדי שאפשר יהיה לתקן ידנית.
  let meetUrl: string | null = null;
  let calendarSynced = false;

  if (isCalendarConfigured()) {
    try {
      const detailLines = [
        `נקבע דרך מערכת זימון הפגישות.`,
        `שם: ${input.name}`,
        `מייל: ${input.email}`,
        phone ? `טלפון: ${phone}` : null,
        input.notes?.trim() ? `\nמה שנכתב בטופס:\n${input.notes.trim()}` : null,
      ].filter(Boolean);

      const event = await createCalendarEvent({
        calendarId: settings.calendar_id,
        summary: `${eventType.name} — ${input.name}`,
        description: detailLines.join("\n"),
        start,
        end,
        timeZone: settings.timezone,
        attendeeEmail: input.email,
        attendeeName: input.name,
        withMeet: eventType.location === "google_meet",
        location:
          eventType.location === "google_meet"
            ? null
            : (eventType.location_details ?? BOOKING_LOCATION_LABELS[eventType.location]),
      });

      meetUrl = event.meetUrl;
      calendarSynced = true;

      await db
        .from("bookings")
        .update({ google_event_id: event.eventId, google_meet_url: event.meetUrl })
        .eq("id", booking.id);
    } catch (error) {
      console.error("[booking] calendar event creation failed:", error);
    }
  }

  // ── 5. רישום ביומן איש הקשר ועדכון סטטוס ─────────────────────────────
  if (contact) {
    await db.from("interactions").insert({
      contact_id: contact.id,
      type: "booking_created",
      content: `קבע/ה פגישה: ${eventType.name} — ${formatDateTime(start, settings.timezone)}`,
    });

    if (eventType.set_contact_status && contact.status !== eventType.set_contact_status) {
      const { error } = await db
        .from("contacts")
        .update({ status: eventType.set_contact_status })
        .eq("id", contact.id);
      if (error) console.error("[booking] status update failed:", error.message);
    }
  }

  // ── 6. מייל אישור ─────────────────────────────────────────────────────
  // אחרון, ובלי לחסום: הפגישה כבר קיימת, וכשל בשליחת מייל לא הופך אותה
  // ללא-קיימת. הלקוח רואה את האישור על המסך בכל מקרה.
  try {
    const { subject, html } = buildConfirmationEmail({
      eventType,
      inviteeName: input.name,
      start,
      timeZone: settings.timezone,
      meetUrl,
      cancelUrl: `${appUrl()}/book/cancel/${booking.cancel_token}`,
      brandName: settings.brand_name,
    });
    await sendEmail({ to: input.email, subject, html });
  } catch (error) {
    console.error("[booking] confirmation email failed:", error);
  }

  return { ok: true, booking, meetUrl, calendarSynced };
}

/** ביטול פגישה — מהקישור שבמייל (invitee) או מהדשבורד (team). */
export async function cancelBooking(
  booking: Booking,
  cancelledBy: "invitee" | "team"
): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  if (booking.status === "cancelled") return { ok: true };

  const settings = await getBookingSettings();

  if (booking.google_event_id && isCalendarConfigured()) {
    try {
      await deleteCalendarEvent({
        calendarId: settings.calendar_id,
        eventId: booking.google_event_id,
      });
    } catch (error) {
      console.error("[booking] calendar event deletion failed:", error);
    }
  }

  const { error } = await db
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy,
    })
    .eq("id", booking.id)
    .eq("status", "confirmed");

  if (error) return { ok: false, error: error.message };

  const { data: eventType } = await db
    .from("booking_event_types")
    .select("*")
    .eq("id", booking.event_type_id)
    .maybeSingle();

  if (booking.contact_id) {
    await db.from("interactions").insert({
      contact_id: booking.contact_id,
      type: "booking_cancelled",
      content: `בוטלה פגישה: ${eventType?.name ?? ""} — ${formatDateTime(
        new Date(booking.starts_at),
        settings.timezone
      )} (בוטל על ידי ${cancelledBy === "invitee" ? "הלקוח" : "הצוות"})`,
    });
  }

  // מייל ביטול נשלח רק כשגוגל לא עשה זאת בשבילנו: מחיקת אירוע עם sendUpdates
  // כבר שולחת ללקוח הודעת ביטול, ושני מיילים על אותו דבר זה רעש.
  const googleNotified = Boolean(booking.google_event_id) && isCalendarConfigured();
  if (!googleNotified && eventType) {
    try {
      const { subject, html } = buildCancellationEmail({
        eventType,
        inviteeName: booking.invitee_name,
        start: new Date(booking.starts_at),
        timeZone: settings.timezone,
        brandName: settings.brand_name,
        rebookUrl: `${appUrl()}/book/${eventType.slug}`,
      });
      await sendEmail({ to: booking.invitee_email, subject, html });
    } catch (error) {
      console.error("[booking] cancellation email failed:", error);
    }
  }

  return { ok: true };
}
