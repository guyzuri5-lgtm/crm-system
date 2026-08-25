import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getActiveEventTypeBySlug } from "@/lib/booking/data";
import { createBooking } from "@/lib/booking/create";

// POST /api/booking — קביעת פגישה מהדף הציבורי.
//
// endpoint ציבורי, ולכן כל שדה עובר ולידציה ואורך מוגבל. שימו לב ש-notes נשמר
// ונשלח ליומן אבל *לא* משוכפל למייל שנשלח ללקוח — טקסט חופשי מ-endpoint פתוח
// שחוזר במייל היה הופך את המערכת לממסר ספאם (אותו שיקול כמו ב-webhook של השאלון).
export const dynamic = "force-dynamic";

const bookingSchema = z.object({
  slug: z.string().min(1).max(80),
  start: z.string().min(1).max(40),
  name: z.string().trim().min(2, "נא למלא שם").max(120),
  email: z.string().trim().email("כתובת מייל לא תקינה").max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  timezone: z.string().trim().max(60).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "בקשה לא תקינה", field: first?.path?.[0] },
      { status: 400 }
    );
  }

  const eventType = await getActiveEventTypeBySlug(parsed.data.slug);
  if (!eventType) return NextResponse.json({ error: "סוג הפגישה לא נמצא" }, { status: 404 });

  try {
    const result = await createBooking({
      eventType,
      startIso: parsed.data.start,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      notes: parsed.data.notes ?? null,
      inviteeTimezone: parsed.data.timezone ?? null,
    });

    if (!result.ok) {
      // 409 על שעה תפוסה: הדף הציבורי מזהה את הקוד הזה, מרענן את הסלוטים
      // ומבקש מהלקוח לבחור מחדש, במקום להציג שגיאה סתמית.
      const status =
        result.code === "slot_taken" ? 409 : result.code === "calendar_unavailable" ? 503 : 400;
      return NextResponse.json({ error: result.error, code: result.code }, { status });
    }

    return NextResponse.json(
      {
        ok: true,
        bookingId: result.booking.id,
        cancelToken: result.booking.cancel_token,
        meetUrl: result.meetUrl,
        calendarSynced: result.calendarSynced,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[booking] create failed:", error);
    return NextResponse.json({ error: "קביעת הפגישה נכשלה" }, { status: 500 });
  }
}
