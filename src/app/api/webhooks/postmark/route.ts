import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { recordReceipts, type RecordReceiptInput } from "@/lib/receipts";

/**
 * /api/webhooks/postmark — מה קרה למייל אחרי שיצא.
 *
 * להגדיר ב-Postmark, **לכל זרם בנפרד** (Broadcast ל-ניוזלטר, Outbound
 * לתפעולי): Streams ← <הזרם> ← Settings ← Webhooks ← Add webhook
 *   URL = https://<הדומיין>/api/webhooks/postmark?secret=<POSTMARK_WEBHOOK_SECRET>
 *   ולסמן: Delivery · Open · Link Click · Bounce · Spam Complaint
 *
 * ── האימות יושב בכתובת ──
 * Postmark אינו חותם את הבקשות, ומה שהוא מציע הוא Basic Auth או כתובת סודית.
 * הסוד בכתובת הוא אותו דפוס שכבר נהוג כאן מול גרואו והשאלון: הכתובת *היא*
 * הסוד, ולכן היא לא נרשמת ביומן ולא מוצגת באף מסך.
 *
 * ── תמיד 200 אחרי האימות ──
 * Postmark חוזר על webhook שנענה בשגיאה, עשר פעמים לאורך יממה, ואז מכבה את
 * ה-webhook לגמרי. דיווח שאיננו יודעים לעכל אינו שווה את זה: הוא נתון חסר
 * בסטטיסטיקה, ולא אירוע שדורש התערבות.
 */
export const dynamic = "force-dynamic";

function verifySecret(params: URLSearchParams): boolean {
  const expected = process.env.POSTMARK_WEBHOOK_SECRET?.trim();
  // בלי סוד מוגדר ה-endpoint סגור — אחרת כל אחד יכול להזריק "נפתח" ולזייף
  // את המספרים שגיא מקבל בהם החלטות.
  if (!expected) return false;

  const received = params.get("secret") ?? params.get("token") ?? "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * דיווח בודד מ-Postmark.
 *
 * השדות אופציונליים כי כל RecordType שולח תת-קבוצה אחרת: ל-Delivery יש
 * DeliveredAt, ל-Bounce יש BouncedAt, ולפתיחה וקליק יש ReceivedAt.
 */
/**
 * ה-MessageID שמופיע בבקשות האימות של Postmark.
 *
 * ── למה זה לא ניקיון אלא תיקון באג ──
 * לפני ש-Postmark שומר webhook הוא שולח אליו payload לדוגמה — אחד מכל סוג
 * אירוע שסומן, **כולל SpamComplaint עם כתובת מייל מומצאת**. הקוד כאן מסמן
 * מתלונן כמוסר מרשימת התפוצה, ולכן בלי החסימה הזו כל יצירה או עריכה של
 * webhook הייתה עלולה להוציא לקוח אמיתי מהדיוור — בשקט, בלי שאיש יבקש.
 *
 * נבדק בפועל ב-8.9.2026: האימות אכן יצר שורת דיווח מלאה (נמסר, נפתח פעמיים
 * ותלונת ספאם) על המזהה הזה. הכתובת שבה השתמש לא הייתה שייכת לאיש, ולכן
 * לא נגרם נזק — אבל זה היה מזל ולא תכנון.
 *
 * המזהה קבוע אצל Postmark, ולכן ניתן לזיהוי בוודאות.
 */
const VERIFICATION_MESSAGE_ID = "00000000-0000-0000-0000-000000000000";

interface PostmarkEvent {
  RecordType?: string;
  MessageID?: string;
  Recipient?: string;
  Email?: string;
  DeliveredAt?: string;
  ReceivedAt?: string;
  BouncedAt?: string;
  Description?: string;
  Details?: string;
  Name?: string;
  Type?: string;
}

export async function POST(request: NextRequest) {
  if (!verifySecret(request.nextUrl.searchParams)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Postmark שולח אירוע אחד לכל בקשה, אבל מערך מתקבל גם הוא — זה מה שמייצר
  // כלי בדיקה, וזול יותר לקבל אותו מלגלות שהבדיקה נכשלה בלי סיבה אמיתית.
  const received = (Array.isArray(payload) ? payload : [payload]) as PostmarkEvent[];

  // בקשת האימות נענית 200 — היא חייבת, אחרת Postmark לא ישמור את ה-webhook —
  // אבל שום דבר בה אינו נספר ואינו משנה איש קשר.
  const events = received.filter((e) => e.MessageID !== VERIFICATION_MESSAGE_ID);
  const verification = received.length - events.length;

  try {
    const receipts = events.map(toReceipt).filter((r): r is RecordReceiptInput => r !== null);
    const failed = await recordReceipts(receipts);

    // תלונת ספאם היא בקשה מפורשת להפסיק, וחייבת לעצור את הדיוור הבא ולא רק
    // להירשם. בלי זה אותו אדם מקבל את הניוזלטר הבא, מתלונן שוב, והמסירה של
    // *כל* הרשימה נפגעת בגללו.
    const complaints = events.filter((e) => e.RecordType === "SpamComplaint");
    const unsubscribed = await unsubscribeComplainers(complaints);

    return NextResponse.json({
      ok: true,
      events: events.length,
      failed,
      unsubscribed,
      ...(verification ? { verification } : {}),
    });
  } catch (error) {
    console.error("[postmark] webhook failed:", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** דיווח אחד → שורת מעקב, או null אם אינו מסוג שאנחנו סופרים. */
function toReceipt(event: PostmarkEvent): RecordReceiptInput | null {
  if (!event.MessageID) return null;

  const base = { externalId: event.MessageID, channel: "email" as const };

  switch (event.RecordType) {
    case "Delivery":
      return { ...base, event: "delivered", at: iso(event.DeliveredAt) };
    case "Open":
      return { ...base, event: "opened", at: iso(event.ReceivedAt) };
    case "Click":
      return { ...base, event: "clicked", at: iso(event.ReceivedAt) };
    case "Bounce":
      return {
        ...base,
        event: "failed",
        at: iso(event.BouncedAt),
        // Description הוא המשפט הקריא ("The server was unable to deliver…"),
        // Name הוא הסוג ("Hard bounce"). אחד מהם תמיד קיים.
        error: event.Description ?? event.Details ?? event.Name ?? event.Type ?? null,
      };
    case "SpamComplaint":
      return { ...base, event: "failed", at: iso(event.BouncedAt), error: "סומן כספאם על ידי הנמען" };
    default:
      // SubscriptionChange ואחרים — לא נזרקים כשגיאה, פשוט לא נספרים.
      return null;
  }
}

/** תאריך מ-Postmark, או עכשיו אם השדה חסר בדיווח הזה. */
function iso(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * סימון המתלוננים כמוסרים מרשימת התפוצה.
 *
 * לפי הכתובת ולא לפי MessageID: זו הדרך הישירה, והיא עובדת גם על תלונה
 * שהגיעה על מייל שלא מצאנו את שורתו. ההסרה חלה על ניוזלטרים בלבד — מסעות,
 * תזכורות ואישורי פגישה ממשיכים, בדיוק כמו בהסרה רגילה (0022).
 *
 * מחזירה כמה סומנו.
 */
async function unsubscribeComplainers(events: PostmarkEvent[]): Promise<number> {
  const emails = [
    ...new Set(
      events
        .map((e) => (e.Email ?? e.Recipient ?? "").trim().toLowerCase())
        .filter((email) => email.length > 0)
    ),
  ];
  if (!emails.length) return 0;

  const db = supabaseAdmin();
  let marked = 0;

  for (const email of emails) {
    // ilike ולא eq: כתובות נשמרות אצלנו כפי שהוקלדו, ו-Postmark מחזיר את
    // הכתובת המנורמלת. ‎Guy@…‎ ו-‎guy@…‎ הם אותו אדם.
    const { data, error } = await db
      .from("contacts")
      .update({ unsubscribed_at: new Date().toISOString() })
      .ilike("email", email)
      .is("unsubscribed_at", null)
      .select("id");

    if (error) {
      console.error(`[postmark] סימון הסרה נכשל (${email}):`, error);
      continue;
    }
    marked += data?.length ?? 0;
  }

  if (marked) console.warn(`[postmark] ${marked} נמענים סומנו כמוסרים אחרי תלונת ספאם`);
  return marked;
}
