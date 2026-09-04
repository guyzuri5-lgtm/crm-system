import { NextRequest, NextResponse } from "next/server";
import { extractPayer, settlePayment, verifyGrowSecret } from "@/lib/grow";
import { markFailed, markProcessed, recordIncoming } from "@/lib/webhook-inbox";

/**
 * /api/webhooks/grow — אישורי תשלום מגרואו.
 *
 * להגדיר בגרואו, בדף ההגדרות של המסלול:
 *   Webhook URL = https://<הדומיין>/api/webhooks/grow?secret=<GROW_WEBHOOK_SECRET>
 *
 * הסוד יושב בכתובת ולא בכותרת כי זה מה שגרואו מאפשר להגדיר. המשמעות: הכתובת
 * *היא* הסוד — היא לא נרשמת בלוגים כאן ולא מוצגת באף מסך.
 *
 * למה תמיד 200 אחרי האימות: איננו יודעים אם גרואו חוזרת על webhook שנכשל,
 * ומה יקרה אם כן. תשובת שגיאה על תשלום שלא הצלחנו לשייך הייתה עלולה לייצר
 * לולאה, ולא הייתה מקדמת דבר — השיוך תלוי בהתערבות אנושית ולא בניסיון נוסף.
 * במקום זה התשלום נשמר בתיבה עם הסבר ומחכה בהגדרות ← תיבת webhooks.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!verifyGrowSecret(request.nextUrl.searchParams)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await readBody(request);
  if (payload === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // קודם שומרים, אחר כך מבינים.
  const inboxId = await recordIncoming("grow", payload);

  try {
    const target = await settlePayment(extractPayer(payload));
    await markProcessed(inboxId);
    return NextResponse.json({ ok: true, target });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await markFailed(inboxId, reason);
    console.error("[grow] שיוך התשלום נכשל:", reason);
    return NextResponse.json({ ok: false, error: reason });
  }
}

/**
 * הגוף, בלי להניח שהוא JSON.
 *
 * ספקי סליקה ישראליים שולחים לא פעם ‎application/x-www-form-urlencoded‎, ואנחנו
 * לא ראינו עדיין מה גרואו שולחת. ניסיון JSON ואז נפילה חזרה לפרסור טופס עולה
 * שבע שורות, ומונע את המצב שבו התשלום הראשון נדחה ב-400 לפני שהספקנו לראות
 * ולו דוגמה אחת ממנו.
 */
async function readBody(request: NextRequest): Promise<unknown> {
  const raw = await request.text();
  if (!raw.trim()) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const params = new URLSearchParams(raw);
    const entries = Array.from(params.entries());
    // URLSearchParams לא נכשל אף פעם — מחרוזת שאינה טופס פשוט הופכת למפתח
    // בודד בלי ערך. זו הבדיקה שמבחינה בין טופס אמיתי לזבל.
    if (entries.length === 0 || entries.every(([, v]) => !v)) return null;
    return Object.fromEntries(entries);
  }
}
