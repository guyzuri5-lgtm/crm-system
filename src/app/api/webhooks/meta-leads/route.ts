import { NextRequest, NextResponse } from "next/server";
import { markFailed, markProcessed, recordIncoming } from "@/lib/webhook-inbox";
import {
  parseLeadgenEvents,
  processLeadgenEvent,
  verifyLeadsChallenge,
  verifyLeadsSignature,
  type MetaLeadsWebhook,
} from "@/lib/meta-leads";

/**
 * /api/webhooks/meta-leads — לידים מטפסי הפרסום של מטא (Lead Ads).
 *
 * להגדיר פעם אחת ב-Meta for Developers → האפליקציה → Webhooks → Page:
 *   Callback URL  = https://<הדומיין>/api/webhooks/meta-leads
 *   Verify token  = META_LEADS_VERIFY_TOKEN
 *   Subscribe to  = leadgen
 * ובנוסף: מנוי הדף לאפליקציה, וטוקן דף עם leads_retrieval ב-META_LEADS_PAGE_TOKEN.
 *
 * המבנה זהה ל-webhook של וואטסאפ ובמכוון — GET לאימות, POST חתום, ותמיד 200
 * אחרי שהאימות עבר. מטא חוזרת על webhook שלא נענה ב-200, ולכן תשובת שגיאה על
 * ליד שלא הצלחנו לעבד הייתה מייצרת לולאת ניסיונות במקום לפתור משהו.
 *
 * ההבדל המהותי: כאן *כל* payload נשמר ב-webhook_inbox לפני העיבוד. ליד שלא
 * הצלחנו לשייך אינו הולך לאיבוד — הוא נשאר בתיבה עם הסבר, ומחכה במסך
 * ההגדרות. זו ההחלטה המרכזית של השלב הזה: לקוחה שהשאירה פרטים לא נעלמת
 * בגלל שדה שלא זיהינו.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const challenge = verifyLeadsChallenge(request.nextUrl.searchParams);
  if (challenge === null) {
    return NextResponse.json({ error: "verification failed" }, { status: 403 });
  }
  // טקסט גולמי ולא JSON — Meta משווה את הגוף לתו.
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  // הגוף נקרא כטקסט לפני הפרסור, כי החתימה מחושבת על הבייטים המקוריים בדיוק.
  const rawBody = await request.text();

  if (!verifyLeadsSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: MetaLeadsWebhook;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // קודם שומרים, אחר כך מבינים. מכאן והלאה שום כישלון לא מוחק מידע.
  const inboxId = await recordIncoming("meta", payload);

  const events = parseLeadgenEvents(payload);

  // payload בלי leadgen כלל — למשל בדיקת המנוי מהקונסולה של מטא. אין מה
  // לעבד, ולכן הוא מסומן כמעובד ולא נשאר להצטבר בהתראות של מסך ההגדרות.
  if (events.length === 0) {
    await markProcessed(inboxId);
    return NextResponse.json({ ok: true, leads: 0 });
  }

  const failures: string[] = [];
  let handled = 0;

  for (const event of events) {
    try {
      await processLeadgenEvent(event);
      handled++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(event.formId ? `טופס ${event.formId}: ${reason}` : reason);
      console.error("[meta-leads] עיבוד ליד נכשל:", reason);
    }
  }

  // השורה נחשבת מעובדת רק אם *כל* הלידים שבה עברו. payload עם שני לידים
  // שאחד מהם נכשל חייב להישאר גלוי — אחרת הכישלון היה נבלע בהצלחה שלידו.
  if (failures.length) await markFailed(inboxId, failures.join(" | "));
  else await markProcessed(inboxId);

  return NextResponse.json({ ok: true, leads: handled, failed: failures.length });
}
