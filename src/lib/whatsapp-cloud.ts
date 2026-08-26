import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * לקוח WhatsApp Cloud API — הערוץ הרשמי של Meta.
 *
 * שני כללים של Meta מעצבים את כל מה שכאן, וכדאי להכיר אותם לפני שקוראים:
 *
 *   1. **חלון 24 השעות.** אחרי שהלקוח כותב לנו נפתח חלון של 24 שעות שבו
 *      מותר לשלוח לו כל טקסט חופשי, בחינם. מחוץ לחלון מותר לשלוח *רק* תבנית
 *      שאושרה מראש על ידי Meta, והיא מחויבת.
 *   2. **תבנית מזוהה לפי שם ושפה.** אין ישות ביניים לבנות ואין מזהה אטום —
 *      מה שרשום ב-message_templates.meta_template_name הוא בדיוק מה שמופיע
 *      בממשק של Meta.
 *
 *  ההבדל מ-ManyChat, שעבד מול אותו API: שם היה צריך לבנות "פלואו" ידני לכל
 *  תבנית ולשלוח טקסט חופשי דרך שדה מותאם, כי המתווך לא חשף את היכולות
 *  האמיתיות. כאן זו קריאת HTTP אחת לכל מקרה.
 *
 * תיעוד: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

// גרסת Graph API נתמכת כשנתיים ואז פגה. מיושרת למה שהקונסולה של Meta עצמה
// מייצרת בדוגמאות ה-curl שלה — זה המקור הכי מהימן לגרסה שבאמת פעילה היום.
// אפשר לדרוס דרך WHATSAPP_API_VERSION בלי לגעת בקוד.
const DEFAULT_API_VERSION = "v25.0";

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp Cloud API אינו מוגדר — יש להגדיר WHATSAPP_PHONE_NUMBER_ID ו-WHATSAPP_ACCESS_TOKEN (ראו README, סעיף \"וואטסאפ דרך Cloud API\")."
    );
    this.name = "WhatsAppNotConfiguredError";
  }
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

async function graphFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfiguredError();

  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const response = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    // Meta מחזירה הסבר אמיתי ב-error.message ("Template name does not exist
    // in the translation"), והוא שווה הרבה יותר מקוד הסטטוס לבדו.
    const detail =
      (payload as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
    throw new WhatsAppApiError(detail, response.status, payload);
  }

  return payload as T;
}

export interface PhoneNumberStatus {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** GREEN / YELLOW / RED — הדירוג ש-Meta נותנת למספר לפי תלונות של נמענים */
  qualityRating: string | null;
  /** התקרה היומית ש-Meta מטילה, למשל "TIER_1K" */
  messagingLimitTier: string | null;
}

/**
 * מצב המספר אצל Meta — המקבילה של "האם החיבור חי".
 *
 * quality_rating הוא הדבר שכדאי להסתכל עליו: הוא נגזר מתלונות וחסימות של
 * נמענים, וירידה שלו ל-RED מקדימה הגבלה בפועל. זו ההתראה המוקדמת היחידה
 * שיש, והיא לא מגיעה לשום מקום אחר אלא אם בודקים.
 *
 * GET ולא POST, ולכן לא עובר דרך graphFetch.
 */
export async function getPhoneNumberStatus(): Promise<PhoneNumberStatus> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfiguredError();

  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const fields = "display_phone_number,verified_name,quality_rating,messaging_limit_tier";
  const response = await fetch(
    `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
    throw new WhatsAppApiError(detail, response.status, payload);
  }

  const body = payload as Record<string, string | undefined>;
  return {
    displayPhoneNumber: body.display_phone_number ?? null,
    verifiedName: body.verified_name ?? null,
    qualityRating: body.quality_rating ?? null,
    messagingLimitTier: body.messaging_limit_tier ?? null,
  };
}

// ── מספר טלפון ⟷ wa_id ──────────────────────────────────────────────────

/** קידומת המדינה להמרת מספר מקומי. ישראל, כמו בשאר המערכת. */
const DEFAULT_COUNTRY_CODE = "972";

function countryCode(): string {
  return (process.env.WHATSAPP_COUNTRY_CODE || DEFAULT_COUNTRY_CODE).replace(/\D/g, "");
}

/**
 * "0501234567" → "972501234567".
 *
 * זה גם מה ש-Meta קוראת לו wa_id וגם מה שנכנס לשדה "to" בשליחה — אותה מחרוזת
 * בדיוק, בלי + ובלי מפרידים.
 */
export function waIdFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = countryCode() + digits.slice(1);

  // וואטסאפ עצמה דורשת 11–16 ספרות. קצר מזה הוא קו נייח או שגיאת הקלדה.
  if (digits.length < 11 || digits.length > 16) return null;
  return digits;
}

/**
 * "972501234567" → "0501234567".
 *
 * הצורה המקומית ולא הבינלאומית, כי זו הצורה שכל שאר המערכת שומרת בה
 * (normalizePhone) — והיא מה שמאפשר למצוא איש קשר שנוצר מהשאלון או מייבוא
 * אקסל במקום ליצור אותו מחדש ככפילות.
 */
export function phoneFromWaId(waId: string | null | undefined): string | null {
  if (!waId) return null;
  const digits = waId.replace(/\D/g, "");
  if (!digits) return null;

  const code = countryCode();
  if (digits.startsWith(code)) return `0${digits.slice(code.length)}`;
  return `+${digits}`;
}

// ── חלון 24 השעות ───────────────────────────────────────────────────────

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * האם מותר לשלוח לאיש הקשר טקסט חופשי.
 *
 * החלון נמדד מההודעה האחרונה שה*לקוח* שלח, ולא מכל אינטראקציה: הודעה שאנחנו
 * שלחנו אינה פותחת חלון ואינה מאריכה אותו.
 */
export function isWithin24HourWindow(
  lastIncomingMessageAt: string | null,
  now: Date = new Date()
): boolean {
  if (!lastIncomingMessageAt) return false;
  return now.getTime() - new Date(lastIncomingMessageAt).getTime() < WINDOW_MS;
}

/** כמה זמן נשאר בחלון, במילישניות. 0 כשהוא סגור — לתצוגה בכרטיס הלקוח. */
export function windowRemainingMs(
  lastIncomingMessageAt: string | null,
  now: Date = new Date()
): number {
  if (!lastIncomingMessageAt) return 0;
  const elapsed = now.getTime() - new Date(lastIncomingMessageAt).getTime();
  return Math.max(0, WINDOW_MS - elapsed);
}

// ── שליחה ───────────────────────────────────────────────────────────────

interface SendResponse {
  messages?: { id?: string }[];
}

function messagesPath(): string {
  return `${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

/**
 * טקסט חופשי. תקף **רק בתוך חלון 24 השעות** — מחוצה לו Meta דוחה את הבקשה
 * עם שגיאה מפורשת, ולכן אין כאן בדיקה כפולה: ההחלטה נלקחת ב-send.ts, ו-Meta
 * היא הסמכות האחרונה.
 */
export async function sendText(waId: string, text: string): Promise<string | null> {
  const result = await graphFetch<SendResponse>(messagesPath(), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waId,
    type: "text",
    text: { preview_url: false, body: text },
  });
  return result?.messages?.[0]?.id ?? null;
}

export interface TemplateSend {
  waId: string;
  /** שם התבנית כפי שאושרה ב-Meta */
  name: string;
  /** קוד השפה שאיתו אושרה ("he", "en_US"). חייב להתאים בדיוק. */
  languageCode: string;
  /** הערכים ל-{{1}}, {{2}} ... לפי הסדר */
  parameters: string[];
}

/**
 * תבנית מאושרת. הדרך היחידה לפנות ללקוח מחוץ לחלון.
 *
 * components נשלח רק כשיש פרמטרים: תבנית בלי משתנים שנשלחת עם מערך parameters
 * ריק נדחית על ידי Meta, ולא מתקבלת כתבנית פשוטה.
 */
export async function sendTemplate({
  waId,
  name,
  languageCode,
  parameters,
}: TemplateSend): Promise<string | null> {
  const result = await graphFetch<SendResponse>(messagesPath(), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waId,
    type: "template",
    template: {
      name,
      language: { code: languageCode },
      ...(parameters.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: parameters.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
  return result?.messages?.[0]?.id ?? null;
}

// ── Webhooks ────────────────────────────────────────────────────────────

/**
 * אימות ה-webhook בהרשמה: Meta שולחת GET עם hub.challenge, ומצפה לקבל אותו
 * בחזרה כטקסט גולמי. זה קורה פעם אחת, כשמחברים את הכתובת בממשק של Meta.
 */
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== expected) return null;
  return params.get("hub.challenge");
}

/**
 * אימות החתימה על כל webhook נכנס.
 *
 * Meta חותמת את **גוף הבקשה הגולמי** ב-HMAC-SHA256 עם ה-App Secret, ושולחת
 * את התוצאה ככותרת ‎X-Hub-Signature-256: sha256=<hex>‎. חובה לחשב על הגוף
 * הגולמי בדיוק — JSON.stringify של האובייקט שפורסר מייצר מחרוזת אחרת (סדר
 * מפתחות, רווחים) והחתימה לעולם לא תתאים.
 *
 * ההשוואה ב-timingSafeEqual ולא ב-===: השוואת מחרוזות רגילה נעצרת בתו הראשון
 * שנבדל, וההפרש בזמן מאפשר לנחש חתימה תו אחר תו.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  // בלי App Secret אין מה לאמת. מוחזר false ולא true: webhook לא חתום הוא
  // בדיוק מה שתוקף היה שולח, ו"פתוח כברירת מחדל" כאן פירושו שכל אחד יכול
  // להזריק הודעות ל-CRM.
  if (!secret) return false;
  if (!header?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * מבנה ה-webhook של Meta.
 *
 * הכל אופציונלי בכוונה: אותו endpoint מקבל הודעות נכנסות, עדכוני מסירה,
 * ושינויים בחשבון — כל אחד עם תת-אובייקט אחר. טיפוס נוקשה כאן היה נשבר
 * בפעם הראשונה שמישהו ישלח מדבקה.
 */
export interface WhatsAppWebhook {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: WhatsAppInboundMessage[];
        statuses?: {
          id?: string;
          status?: string;
          recipient_id?: string;
          errors?: { code?: number; title?: string; message?: string }[];
        }[];
      };
    }[];
  }[];
}

export interface WhatsAppInboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: Record<string, unknown>;
  sticker?: Record<string, unknown>;
  location?: { name?: string; address?: string };
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

export interface ParsedInboundMessage {
  /** wamid — המפתח לדה-דופליקציה של webhook שנשלח שוב */
  messageId: string;
  waId: string;
  phone: string | null;
  senderName: string | null;
  /** הטקסט, או תיאור קצר לסוג הודעה שאינו טקסט ("[תמונה]") */
  text: string;
  sentAt: string;
}

/**
 * תיאור קריא להודעה שאינה טקסט.
 *
 * שורה ריקה ביומן איש הקשר גרועה יותר מ"[תמונה]": מי שקורא את היומן צריך
 * לדעת שהייתה כאן הודעה, גם אם התוכן שלה לא נשמר אצלנו.
 */
const NON_TEXT_LABELS: Record<string, string> = {
  image: "[תמונה]",
  video: "[וידאו]",
  document: "[קובץ]",
  audio: "[הודעה קולית]",
  voice: "[הודעה קולית]",
  sticker: "[מדבקה]",
  location: "[מיקום]",
  contacts: "[איש קשר]",
  reaction: "[תגובה]",
  unsupported: "[הודעה בפורמט לא נתמך]",
};

function messageText(message: WhatsAppInboundMessage): string {
  const direct =
    message.text?.body ??
    // לחיצה על כפתור בתבנית מגיעה כטקסט הכפתור, וזו תשובה אמיתית של הלקוח
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title;
  if (direct?.trim()) return direct.trim();

  const label = NON_TEXT_LABELS[message.type ?? ""] ?? "[הודעה]";
  const caption =
    message.image?.caption?.trim() ??
    message.video?.caption?.trim() ??
    message.document?.caption?.trim() ??
    message.document?.filename?.trim() ??
    message.location?.address?.trim();

  return caption ? `${label} ${caption}` : label;
}

/**
 * שליפת ההודעות הנכנסות מתוך ה-webhook, יחד עם שם הפרופיל של השולח.
 *
 * webhook אחד יכול לשאת כמה הודעות, מכמה שולחים — ולכן זו רשימה ולא הודעה
 * בודדת. שם הפרופיל יושב במערך contacts ולא על ההודעה, וההצמדה ביניהם היא
 * לפי wa_id.
 */
export function parseInboundMessages(payload: WhatsAppWebhook): ParsedInboundMessage[] {
  const parsed: ParsedInboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;

      const namesByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        const name = contact.profile?.name?.trim();
        if (contact.wa_id && name) namesByWaId.set(contact.wa_id, name);
      }

      for (const message of value.messages) {
        if (!message.id || !message.from) continue;
        parsed.push({
          messageId: message.id,
          waId: message.from,
          phone: phoneFromWaId(message.from),
          senderName: namesByWaId.get(message.from) ?? null,
          text: messageText(message),
          // timestamp מגיע כשניות מאז ה-epoch, כמחרוזת.
          sentAt: message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }
  }

  return parsed;
}

export interface ParsedStatus {
  messageId: string;
  status: string;
  error: string | null;
}

/**
 * עדכוני מסירה. מעניין אותנו בעיקר "failed" — הודעה שנשלחה בהצלחה מבחינת
 * ה-API אבל לא הגיעה ליעד, וזה נודע רק כאן.
 */
export function parseStatuses(payload: WhatsAppWebhook): ParsedStatus[] {
  const parsed: ParsedStatus[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        const firstError = status.errors?.[0];
        parsed.push({
          messageId: status.id,
          status: status.status,
          error: firstError ? (firstError.message ?? firstError.title ?? null) : null,
        });
      }
    }
  }
  return parsed;
}
