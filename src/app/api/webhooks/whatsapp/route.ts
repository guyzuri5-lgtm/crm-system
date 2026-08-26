import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  parseInboundMessages,
  parseStatuses,
  verifyWebhookChallenge,
  verifyWebhookSignature,
  type ParsedInboundMessage,
  type WhatsAppWebhook,
} from "@/lib/whatsapp-cloud";
import { phoneVariants } from "@/lib/contact-import";

/**
 * /api/webhooks/whatsapp — הודעות נכנסות ועדכוני מסירה מ-Meta.
 *
 * להגדיר פעם אחת ב-Meta for Developers → האפליקציה → WhatsApp → Configuration:
 *   Callback URL  = https://<הדומיין>/api/webhooks/whatsapp
 *   Verify token  = WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Subscribe to  = messages
 *
 * שני חלקים, ושניהם חובה:
 *   GET  — Meta קוראת פעם אחת בהרשמה ומצפה לקבל בחזרה את hub.challenge כטקסט.
 *   POST — האירועים עצמם, חתומים ב-HMAC על גוף הבקשה הגולמי.
 *
 * תמיד 200 על POST שעבר אימות: Meta חוזרת על webhook שלא נענה, ותשובת שגיאה
 * על אירוע שאנחנו לא יודעים לטפל בו הייתה מייצרת לולאת ניסיונות. כשלים
 * אמיתיים נרשמים ללוג ומוחזרים בגוף התשובה.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const challenge = verifyWebhookChallenge(request.nextUrl.searchParams);
  if (challenge === null) {
    return NextResponse.json({ error: "verification failed" }, { status: 403 });
  }
  // טקסט גולמי ולא JSON — Meta משווה את הגוף לתו.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: NextRequest) {
  // הגוף נקרא כטקסט לפני הפרסור, כי החתימה מחושבת על הבייטים המקוריים בדיוק.
  // JSON.stringify של אובייקט מפורסר מייצר מחרוזת אחרת, והאימות לעולם לא היה עובר.
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: WhatsAppWebhook;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const messages = parseInboundMessages(payload);
    const statuses = parseStatuses(payload);

    const handled: string[] = [];
    for (const message of messages) {
      const result = await handleInbound(message);
      if (result) handled.push(result);
    }

    await recordFailures(statuses);

    return NextResponse.json({ ok: true, messages: handled.length, statuses: statuses.length });
  } catch (error) {
    console.error("[whatsapp] webhook failed:", error);
    return NextResponse.json({ ok: false, error: describe(error) });
  }
}

/**
 * הודעת שגיאה קריאה.
 *
 * String(error) לא מספיק: שגיאות של supabase-js אינן מופעים של Error אלא
 * אובייקטים רגילים, ו-String עליהם מחזיר "[object Object]" — כלומר בדיוק
 * כלום, במקום שיהיה כתוב איזו עמודה חסרה.
 *
 * 42703 ו-PGRST204 שניהם "העמודה לא קיימת" — האחד מפוסטגרס והשני מ-PostgREST,
 * תלוי דרך איזו שכבה הבקשה עברה. שניהם אומרים אותו דבר: המיגרציה לא הורצה.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;

  const candidate = error as { code?: string; message?: string } | null;
  if (candidate?.code === "42703" || candidate?.code === "PGRST204") {
    return `${candidate.message} — יש להריץ את supabase/migrations/0011_whatsapp_cloud_api.sql ב-SQL editor של Supabase.`;
  }
  if (candidate?.message) return candidate.message;
  return String(error);
}

/** מחזיר את מזהה איש הקשר שנרשמה לו ההודעה, או null אם דילגנו. */
async function handleInbound(message: ParsedInboundMessage): Promise<string | null> {
  const db = supabaseAdmin();

  // דה-דופליקציה לפני כל דבר אחר: Meta חוזרת על webhook שלא נענה, ובלי
  // הבדיקה הזו ניסיון חוזר היה מוסיף שורה שנייה לאותה הודעה.
  const { data: seen, error: seenError } = await db
    .from("interactions")
    .select("id")
    .eq("external_id", message.messageId)
    .maybeSingle();
  if (seenError) throw seenError;
  if (seen) return null;

  const contact = await findOrCreateContact(message);

  const { error: interactionError } = await db.from("interactions").insert({
    contact_id: contact.id,
    type: "whatsapp_in",
    content: message.text,
    external_id: message.messageId,
  });
  // מרוץ בין שני ניסיונות מקבילים על אותה הודעה — האינדקס היחיד תופס אותו,
  // וזה בדיוק מה שהוא נועד לעשות. לא שגיאה.
  if (interactionError && interactionError.code !== "23505") throw interactionError;

  // זה מה שפותח את חלון 24 השעות. נשמר זמן ההודעה מ-Meta ולא "עכשיו": webhook
  // שהגיע באיחור אחרי תקלת רשת היה מאריך את החלון בטעות.
  const { error } = await db
    .from("contacts")
    .update({ last_incoming_message_at: message.sentAt })
    .eq("id", contact.id);
  if (error) throw error;

  return contact.id;
}

/**
 * איתור איש הקשר, ופתיחת כרטיס חדש אם אין.
 *
 * החיפוש בשני שלבים כי אותו אדם יכול להיות שמור אצלנו משני מקורות בפורמטים
 * שונים — wa_id שנשמר בפעם הקודמת, או ‎0501234567‎ מהשאלון ומייבוא אקסל.
 */
async function findOrCreateContact(message: ParsedInboundMessage) {
  const db = supabaseAdmin();

  const { data: byWaId, error: waIdError } = await db
    .from("contacts")
    .select("*")
    .eq("whatsapp_id", message.waId)
    .maybeSingle();
  if (waIdError) throw waIdError;
  if (byWaId) return byWaId;

  if (message.phone) {
    const { data: byPhone, error: phoneError } = await db
      .from("contacts")
      .select("*")
      .in("phone", phoneVariants(message.phone))
      .limit(1);
    if (phoneError) throw phoneError;

    const existing = byPhone?.[0];
    if (existing) {
      // קישור ה-wa_id לכרטיס הקיים, כדי שההודעה הבאה תימצא מיד בשלב הראשון.
      const { data: linked, error } = await db
        .from("contacts")
        .update({ whatsapp_id: message.waId })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return linked;
    }
  }

  const { data: created, error: insertError } = await db
    .from("contacts")
    .insert({
      whatsapp_id: message.waId,
      full_name: message.senderName,
      phone: message.phone,
      source: "WhatsApp",
      last_incoming_message_at: message.sentAt,
    })
    .select("*")
    .single();

  if (insertError) {
    // בקשה מקבילה הספיקה ליצור את אותו איש קשר בין החיפוש לכתיבה.
    if (insertError.code === "23505") {
      const { data: raced } = await db
        .from("contacts")
        .select("*")
        .eq("whatsapp_id", message.waId)
        .maybeSingle();
      if (raced) return raced;
    }
    throw insertError;
  }

  return created;
}

/**
 * הודעה שיצאה בהצלחה מבחינת ה-API אבל לא הגיעה ליעד.
 *
 * זה נודע *רק* כאן — הקריאה לשליחה החזירה 200 ומזהה הודעה, והכישלון מתגלה
 * שניות אחר כך. בלי הרישום הזה, "שלחתי ללקוח" ביומן היה שקר שאיש לא מגלה.
 *
 * נרשם על השורה הקיימת ולא כשורה חדשה: זו אותה הודעה, רק עם מידע חדש עליה.
 */
async function recordFailures(statuses: { messageId: string; status: string; error: string | null }[]) {
  const failures = statuses.filter((status) => status.status === "failed");
  if (!failures.length) return;

  const db = supabaseAdmin();
  for (const failure of failures) {
    const { data: existing } = await db
      .from("interactions")
      .select("id, content")
      .eq("external_id", failure.messageId)
      .maybeSingle();
    if (!existing) continue;

    const note = `[לא נמסר${failure.error ? `: ${failure.error}` : ""}]`;
    if (existing.content?.startsWith("[לא נמסר")) continue;

    await db
      .from("interactions")
      .update({ content: `${note} ${existing.content ?? ""}`.trim() })
      .eq("id", existing.id);

    console.warn(`[whatsapp] הודעה ${failure.messageId} לא נמסרה: ${failure.error ?? "ללא פירוט"}`);
  }
}
