import { NextRequest, NextResponse } from "next/server";
import { getActiveEventTypeBySlug } from "@/lib/booking/data";
import { getAvailableSlots } from "@/lib/booking/slots";
import { addDaysToDateKey, parseDateKey } from "@/lib/booking/timezone";

// GET /api/booking/slots?slug=intro&from=2026-08-24&to=2026-09-23
//
// endpoint ציבורי: הוא מגיש את דף ההזמנה, שרץ בלי משתמש מחובר. הוא חושף רק
// שעות פנויות — לא כותרות אירועים, לא משתתפים, ולא שום דבר מתוכן היומן.
//
// מוגן בשלוש רצועות: slug של סוג פגישה פעיל בלבד, טווח תאריכים חסום ל-62 יום
// לכל קריאה, ותשובה שנגזרת כולה מה-DB ומ-freeBusy בלי טקסט חופשי מהבקשה.
export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 62;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!slug) return NextResponse.json({ error: "missing slug" }, { status: 400 });
  if (!from || !parseDateKey(from)) {
    return NextResponse.json({ error: "invalid from date" }, { status: 400 });
  }
  if (!to || !parseDateKey(to)) {
    return NextResponse.json({ error: "invalid to date" }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ error: "to must not precede from" }, { status: 400 });
  }
  // חסם קשיח על גודל החלון: כל יום בטווח נסרק בלולאה, וללא החסם הזה קריאה
  // אחת עם טווח של עשור הייתה עבודה כבדה שכל אנונימי יכול להזמין.
  if (to > addDaysToDateKey(from, MAX_RANGE_DAYS)) {
    return NextResponse.json(
      { error: `range must not exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 }
    );
  }

  const eventType = await getActiveEventTypeBySlug(slug);
  if (!eventType) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const { timeZone, days } = await getAvailableSlots({
      eventType,
      fromDateKey: from,
      toDateKey: to,
    });
    return NextResponse.json({ timeZone, days, durationMinutes: eventType.duration_minutes });
  } catch (error) {
    if (error instanceof Error && error.message === "calendar_unavailable") {
      // 503 ולא 200 עם רשימה ריקה: "אין שעות פנויות" ו"לא הצלחנו לבדוק"
      // נראים זהים ללקוח, והראשון שקרי כאן.
      return NextResponse.json({ error: "calendar_unavailable" }, { status: 503 });
    }
    console.error("[booking] slots lookup failed:", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
