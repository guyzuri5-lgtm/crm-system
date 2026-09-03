import { NextResponse } from "next/server";
import { buildIcs, getEventById } from "@/lib/events";

/**
 * GET /api/events/{id}/ics — קובץ יומן להורדה מעמוד התודה.
 *
 * ציבורי בכוונה, ובלי סוד: עמוד התודה עצמו ציבורי (גרואו מפנה אליו אחרי
 * תשלום, מדומיין אחר ובלי session), וכל מה שהקובץ חושף — שם, מועד ומיקום —
 * גלוי ממילא בדף ההרשמה. אין כאן שום פרט על מי נרשמה.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: RouteContext<"/api/events/[id]/ics">) {
  const { id } = await params;

  const event = await getEventById(id);
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(buildIcs(event), {
    headers: {
      // charset מפורש: בלעדיו חלק מהיומנים קוראים את השם העברי כ-Latin-1.
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="event.ics"',
      "Cache-Control": "no-store",
    },
  });
}
