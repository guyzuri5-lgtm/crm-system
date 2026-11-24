import "server-only";

import { WhatsAppApiError } from "./whatsapp-cloud";

/**
 * הגשר הלא רשמי — מספר וואטסאפ ביזנס שמחובר כ"מכשיר מקושר" (ספריית
 * Baileys), ורץ על שרת קטן משלו. הקוד שלו בתיקייה whatsapp-bridge/ בשורש.
 *
 * ── למה הוא קיים לצד הערוץ הרשמי ──
 * המספר הרשמי (Cloud API) תקוע מאז ספטמבר 2026: קו האשראי של ManyChat נעול
 * על ה-WABA, ואימות העסק אצל מטא לא מתקדם. כל תבנית נדחית. הגשר עוקף את
 * מטא לגמרי, במחיר אחד שחשוב להכיר: וואטסאפ יכולה לחסום מספר שנראה כמו
 * ספאם. מנגנון הקצב (whatsapp-throttle) ומתג ההשהיה חלים עליו כמו קודם.
 *
 * ── מה משתנה כשהוא מוגדר ──
 * כל השליחה בוואטסאפ עוברת דרכו. אין חלון 24 שעות ואין תבניות מאושרות —
 * אלה כללים של מטא, לא של וואטסאפ. תבנית נשלחת כטקסט המרונדר שלה.
 *
 * ── הכיוון ההפוך ──
 * הודעות נכנסות ודיווחי מסירה מגיעים ל-/api/webhooks/whatsapp, באותו מבנה
 * בדיוק של webhook של מטא, חתומים ב-HMAC עם אותו סוד. כך כל כללי הקליטה
 * (איתור איש קשר לפי טלפון, דה-דופליקציה, אישורי קריאה) משרתים את שניהם.
 */

export function isBridgeConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_BRIDGE_URL && process.env.WHATSAPP_BRIDGE_SECRET);
}

async function bridgeFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.WHATSAPP_BRIDGE_URL!.replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_BRIDGE_SECRET}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    // שרת קטן בענן: עדיף להיכשל בבירור אחרי 25 שניות מאשר להיתקע עד
    // שוורסל קוטעת את הפונקציה כולה.
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new WhatsAppApiError(
      `גשר הוואטסאפ: ${payload?.error ?? `HTTP ${response.status}`}`,
      response.status,
      payload
    );
  }
  return payload as T;
}

/** מחזיר את מזהה ההודעה — אותו תפקיד שיש ל-wamid במסלול הרשמי. */
export async function bridgeSendText(waId: string, text: string): Promise<string | null> {
  const result = await bridgeFetch<{ id?: string | null }>("/send", {
    method: "POST",
    body: JSON.stringify({ to: waId, text }),
  });
  return result?.id ?? null;
}

export interface BridgeStatus {
  /** open · connecting · close · logged_out */
  connection: string;
  /** המספר המחובר, בספרות בלבד (972...) */
  me: string | null;
  registered: boolean;
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  const status = await bridgeFetch<BridgeStatus & { qr?: string | null }>("/status");
  return { connection: status.connection, me: status.me, registered: status.registered };
}
