import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBookingSettings } from "@/lib/booking/data";
import { bookingIcs } from "@/lib/booking/calendar";
import type { BookingEventType } from "@/lib/supabase/database.types";

/**
 * GET /api/booking/ics/{cancel_token} — קובץ יומן לפגישה שנקבעה.
 *
 * ── למה cancel_token ולא מזהה הפגישה ──
 * זה endpoint ציבורי: הוא נלחץ מעמוד האישור ומתוך מייל, בלי שום session.
 * הטוקן הוא סוד שנשלח רק למוזמן, וזו אותה הגנה בדיוק שמאפשרת לו לבטל את
 * הפגישה. מזהה הפגישה, לעומתו, מופיע בכתובות פנימיות ואינו מיועד לכך.
 *
 * ── למה גם פגישה שבוטלה מחזירה 404 ──
 * קובץ יומן לפגישה שכבר בוטלה רק היה מחזיר אותה ליומן של הלקוח. מי שמגיע
 * לכאן אחרי ביטול מקבל אותה תשובה כמו מי שניחש טוקן — אין סיבה להבחין.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/booking/ics/[token]">
) {
  const { token } = await params;

  const { data: booking } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("cancel_token", token)
    .maybeSingle();

  if (!booking || booking.status === "cancelled") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [settings, eventTypeResult] = await Promise.all([
    getBookingSettings(),
    supabaseAdmin()
      .from("booking_event_types")
      .select("*")
      .eq("id", booking.event_type_id)
      .maybeSingle(),
  ]);

  const eventType = eventTypeResult.data as BookingEventType | null;
  if (!eventType) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(bookingIcs(booking, eventType, settings.host_name), {
    headers: {
      // charset מפורש: בלעדיו חלק מהיומנים קוראים את השם העברי כ-Latin-1.
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="meeting.ics"',
      "Cache-Control": "no-store",
    },
  });
}
