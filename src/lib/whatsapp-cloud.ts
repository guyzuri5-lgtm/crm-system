import "server-only";

import { verifyMetaChallenge, verifyMetaSignature } from "./meta-webhook";

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

// ── ניהול תבניות מול Meta ────────────────────────────────────────────────

/**
 * מזהה ה-WABA. נדרש רק לניהול תבניות — השליחה עצמה עוברת דרך מזהה המספר.
 *
 * למה משתנה סביבה ולא גזירה מהטוקן: ניסינו. הצומת של המספר לא חושף את ה-WABA
 * שמעליו, ו-/me/businesses דורש הרשאת business_management שאין לטוקן הזה ואין
 * סיבה לתת לו. ערך מפורש עדיף על קריאה נוספת שממילא תיכשל.
 */
function wabaId(): string {
  const id = process.env.WHATSAPP_WABA_ID?.trim();
  if (!id) {
    throw new Error(
      "WHATSAPP_WABA_ID חסר. הוא נדרש לניהול תבניות מול Meta — מצאו אותו ב-WhatsApp Manager (מזהה חשבון הוואטסאפ העסקי) והוסיפו אותו ל-.env.local ול-Vercel."
    );
  }
  return id;
}

export function isTemplateManagementConfigured(): boolean {
  return isWhatsAppConfigured() && Boolean(process.env.WHATSAPP_WABA_ID?.trim());
}

/** הסיווג של Meta. UTILITY זולה משמעותית ועוברת אישור מהיר יותר מ-MARKETING. */
export const META_TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING"] as const;
export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  /** מופיע רק על תבניות שנדחו, ומסביר מה לתקן */
  rejectedReason: string | null;
  body: string | null;
}

async function graphGet<T>(path: string, params: string): Promise<T> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfiguredError();

  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const response = await fetch(`https://graph.facebook.com/${version}/${path}?${params}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    throw new WhatsAppApiError(detail, response.status, payload);
  }
  return payload as T;
}

/**
 * כל התבניות שקיימות ב-WABA, עם הסטטוס שלהן.
 *
 * זו הפונקציה שמאפשרת לדשבורד לדעת שתבנית נדחתה. בלעדיה רשומה מקומית יכולה
 * להצביע על תבנית שכבר לא קיימת או שנדחתה, והגילוי מגיע רק כששליחה נכשלת —
 * כלומר על לקוח אמיתי, ובשקט.
 */
export async function listMetaTemplates(): Promise<MetaTemplate[]> {
  type Row = {
    id: string;
    name: string;
    language: string;
    status: string;
    category?: string;
    rejected_reason?: string;
    components?: { type: string; text?: string }[];
  };

  const out: MetaTemplate[] = [];
  let path = `${wabaId()}/message_templates`;
  let params = "fields=id,name,language,status,category,rejected_reason,components&limit=100";

  // Meta מחזירה עד 100 בעמוד. חשבון עם הרבה תבניות ותרגומים עובר את זה בקלות,
  // וסנכרון חלקי גרוע מאין סנכרון: הוא היה מסמן תבניות קיימות כחסרות.
  for (let page = 0; page < 10; page++) {
    const res = await graphGet<{ data: Row[]; paging?: { next?: string } }>(path, params);

    for (const row of res.data ?? []) {
      out.push({
        id: row.id,
        name: row.name,
        language: row.language,
        status: row.status,
        category: row.category ?? null,
        rejectedReason:
          row.rejected_reason && row.rejected_reason !== "NONE" ? row.rejected_reason : null,
        body: row.components?.find((c) => c.type === "BODY")?.text ?? null,
      });
    }

    const next = res.paging?.next;
    if (!next) break;
    const url = new URL(next);
    path = url.pathname.replace(/^\/v\d+\.\d+\//, "");
    params = url.searchParams.toString();
  }

  return out;
}

/**
 * יצירת תבנית ב-Meta. מחזירה את המזהה והסטטוס ההתחלתי (בדרך כלל PENDING).
 *
 * example חובה כשיש משתנים: Meta דוחה תבנית עם {{1}} בלי דוגמה למה שממלא
 * אותו, כי המאשר האנושי צריך לראות איך ההודעה נראית בפועל.
 */
export async function createMetaTemplate(input: {
  name: string;
  language: string;
  category: MetaTemplateCategory;
  body: string;
  exampleValues: string[];
}): Promise<{ id: string; status: string; category: string | null }> {
  const component: Record<string, unknown> = { type: "BODY", text: input.body };
  if (input.exampleValues.length > 0) {
    component.example = { body_text: [input.exampleValues] };
  }

  return graphFetch(`${wabaId()}/message_templates`, {
    name: input.name,
    language: input.language,
    category: input.category,
    components: [component],
  });
}

/** מחיקה ב-Meta לפי שם. מוחקת את כל התרגומים של אותו שם. */
export async function deleteMetaTemplate(name: string): Promise<void> {
  if (!isWhatsAppConfigured()) throw new WhatsAppNotConfiguredError();

  const version = process.env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const response = await fetch(
    `https://graph.facebook.com/${version}/${wabaId()}/message_templates?name=${encodeURIComponent(name)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` } }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    throw new WhatsAppApiError(detail, response.status, payload);
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────

/**
 * אימות ה-webhook של וואטסאפ בהרשמה. המנגנון עצמו משותף לכל ה-webhooks של
 * מטא ויושב ב-meta-webhook.ts; מה שמשלנו כאן הוא רק *איזה* טוקן מצופה.
 */
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  return verifyMetaChallenge(params, process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
}

/**
 * אימות החתימה על ה-webhook של וואטסאפ, ב-App Secret של האפליקציה במטא.
 * החישוב עצמו — HMAC על הגוף הגולמי, השוואה בזמן קבוע — משותף ומוסבר
 * ב-meta-webhook.ts.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null): boolean {
  return verifyMetaSignature(rawBody, header, process.env.WHATSAPP_APP_SECRET);
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
  /** המבנה של כפתור "Send to server" בקונסולה — ראו changeValues */
  field?: string;
  value?: WhatsAppChangeValue;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: WhatsAppChangeValue;
    }[];
  }[];
}

export interface WhatsAppChangeValue {
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
}

/**
 * כל אובייקטי ה-value שב-webhook, בלי קשר לצורה שבה הוא הגיע.
 *
 * Meta שולחת שתי צורות שונות לאותו תוכן:
 *   webhook אמיתי  — { object, entry: [{ changes: [{ field, value }] }] }
 *   כפתור הבדיקה   — { field, value }
 *
 * הראשונה היא מה שמגיע בפרודקשן. השנייה מגיעה מ-"Send to server" בקונסולה,
 * שהוא כלי האבחון הראשון שמושיטים אליו יד כשמשהו לא עובד — ובלי לתמוך בו,
 * הוא מחזיר "0 הודעות" ונראה כאילו הכל שבור דווקא כשמנסים לאמת שהכל תקין.
 */
function changeValues(payload: WhatsAppWebhook): WhatsAppChangeValue[] {
  const values: WhatsAppChangeValue[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.value) values.push(change.value);
    }
  }

  // רק כשאין entry בכלל — כדי ששדה value ברמה העליונה לא יוכל לשכפל תוכן
  // שכבר נאסף מהמבנה התקני.
  if (values.length === 0 && payload.value) values.push(payload.value);

  return values;
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

  for (const value of changeValues(payload)) {
    if (!value.messages?.length) continue;

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
  for (const value of changeValues(payload)) {
    for (const status of value.statuses ?? []) {
      if (!status.id || !status.status) continue;
      const firstError = status.errors?.[0];
      parsed.push({
        messageId: status.id,
        status: status.status,
        error: firstError ? (firstError.message ?? firstError.title ?? null) : null,
      });
    }
  }
  return parsed;
}
