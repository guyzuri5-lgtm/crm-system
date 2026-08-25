"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cancelBooking } from "@/lib/booking/create";

/**
 * ביטול פגישה מהקישור שנשלח במייל.
 *
 * Server Action ציבורי — אין כאן משתמש מחובר. ההרשאה היחידה היא הטוקן, ולכן
 * הוא נשלף מהטופס ולא מפרמטר נתיב, ומשמש ישירות כתנאי החיפוש: מי שמחזיק בו
 * מחזיק בפגישה. הטוקן הוא 24 בייטים אקראיים (ראו 0005_booking.sql), לא ה-id,
 * כדי שניחוש מזהים לא יאפשר ביטול פגישות של אחרים.
 */
export async function cancelByToken(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!token) return;

  const { data: booking } = await supabaseAdmin()
    .from("bookings")
    .select("*")
    .eq("cancel_token", token)
    .maybeSingle();

  if (!booking) return;

  await cancelBooking(booking, "invitee");
  revalidatePath(`/book/cancel/${token}`);
}
