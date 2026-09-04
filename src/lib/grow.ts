import "server-only";

import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "./supabase/admin";
import { normalizePhone, usableEmail } from "./quiz";

/**
 * קליטת אישורי תשלום מגרואו (שלב 6).
 *
 * **המבנה של ה-payload אינו ידוע.** לא נבדק כאן מעולם, והוא עשוי להשתנות בין
 * מסלולים ובין גרסאות. לכן כל מה שכאן סלחני במכוון: לא מניחים שמות שדות, לא
 * מניחים עומק קינון, ולא מניחים שהתשלום בכלל ניתן לשיוך. מה שלא הובן נשאר
 * ב-webhook_inbox עם הסבר, וגיא מסמן ידנית — בדיוק כמו לפני השלב הזה.
 *
 * TODO (כיול אחרי ה-payload האמיתי הראשון): ברגע שיגיע תשלום אמיתי, לפתוח את
 * השורה בהגדרות ← תיבת webhooks, לקרוא את המבנה, ולהחליף את החיפוש הרקורסיבי
 * כאן בקריאה ישירה של השדות הנכונים. עד אז הסלחנות היא לא פשרה אלא הדרך
 * היחידה שלא דורשת לנחש.
 */

// ── אימות ──────────────────────────────────────────────────────────────────

/**
 * הסוד מגיע ב-query ולא בכותרת, כי זה מה שממשק ה-webhooks של גרואו מאפשר
 * להגדיר: כתובת אחת, בלי שליטה בכותרות. הכתובת עצמה היא הסוד, ולכן היא לא
 * נרשמת בשום לוג ולא מוצגת במסך.
 */
export function verifyGrowSecret(params: URLSearchParams): boolean {
  const expected = process.env.GROW_WEBHOOK_SECRET?.trim();
  // בלי סוד מוגדר ה-endpoint סגור. "פתוח כברירת מחדל" כאן פירושו שכל אחד
  // יכול לסמן הרשמות כמשולמות.
  if (!expected) return false;

  const received = params.get("secret") ?? params.get("token") ?? "";
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── חילוץ סלחני מתוך payload לא מוכר ───────────────────────────────────────

export interface GrowPayer {
  email: string | null;
  phone: string | null;
  /** שם המוצר/העמוד כפי שהופיע בתשלום, אם נמצא. משמש רק להודעות. */
  productHint: string | null;
}

const EMAIL_KEYS = /mail|מייל|אימייל/i;
// "tel" לבדו היה תופס גם hotel; "telephone" מפורש במקומו.
const PHONE_KEYS = /phone|mobile|cell|telephone|טלפון|נייד/i;
// בלי "name" לבדו — הוא היה תופס customerName והופך את שם הלקוחה ל"שם המוצר"
// בהודעת השגיאה. productName ו-pageName נתפסים ממילא דרך product ו-page.
const PRODUCT_KEYS = /product|item|page|plan|description|title|מוצר/i;

/** תקרות שמירה מפני payload עמוק או ענק שנשלח כדי להעמיס. */
const MAX_DEPTH = 8;
const MAX_NODES = 2000;

/**
 * מעבר על כל הערכים ב-payload, בכל עומק.
 *
 * הדרך היחידה לחלץ משדה שלא יודעים את שמו היא לעבור על כולם. שני מעברים,
 * באותו רעיון כמו בטפסי מטא: קודם לפי שם המפתח, ואם לא נמצא — לפי צורת
 * הערך עצמו. אימייל נראה כמו אימייל גם כשהוא יושב תחת "customerData.f3".
 */
export function extractPayer(payload: unknown): GrowPayer {
  const byKey: { email: string | null; phone: string | null; product: string | null } = {
    email: null,
    phone: null,
    product: null,
  };
  const byShape: { email: string | null; phone: string | null } = { email: null, phone: null };

  let nodes = 0;

  const walk = (node: unknown, key: string, depth: number): void => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, key, depth + 1);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k, depth + 1);
      return;
    }
    if (typeof node !== "string" && typeof node !== "number") return;

    const value = String(node).trim();
    if (!value) return;

    if (!byKey.email && EMAIL_KEYS.test(key) && usableEmail(value)) byKey.email = value;
    if (!byKey.phone && PHONE_KEYS.test(key) && normalizePhone(value)) byKey.phone = value;
    if (!byKey.product && PRODUCT_KEYS.test(key) && value.length <= 120 && !usableEmail(value)) {
      byKey.product = value;
    }
    if (!byShape.email && usableEmail(value)) byShape.email = value;
    if (!byShape.phone && normalizePhone(value)) byShape.phone = value;
  };

  walk(payload, "", 0);

  return {
    email: byKey.email ?? byShape.email,
    phone: byKey.phone ?? byShape.phone,
    productHint: byKey.product,
  };
}

// ── שיוך התשלום להרשמה ─────────────────────────────────────────────────────

interface OpenRegistration {
  table: "event_registrations" | "course_registrations";
  id: string;
  contactId: string;
  targetName: string;
}

/**
 * סימון ההרשמה כמשולמת.
 *
 * זורק בכל מקרה שאינו חד-משמעי, וזו החלטה ולא הימנעות: לסמן "שילמה" על
 * ההרשמה הלא נכונה גרוע יותר מלא לסמן כלום — הראשון שולח לה חומרים של מוצר
 * שלא קנתה ומוציא אותה מרשימת המתעניינות במוצר שכן, והשני משאיר שורה בתיבה
 * שגיא סוגר בשתי לחיצות.
 *
 * מחזיר תיאור קריא של מה שעודכן, לצורך הלוג והתשובה.
 */
export async function settlePayment(payer: GrowPayer): Promise<string> {
  const db = supabaseAdmin();

  const email = payer.email ? usableEmail(payer.email) : null;
  const phone = payer.phone ? normalizePhone(payer.phone) : null;
  if (!email && !phone) {
    throw new Error("לא נמצאו טלפון או אימייל תקינים ב-payload של התשלום");
  }

  // ── מי שילמה ──
  const contactIds = new Set<string>();
  if (phone) {
    const { data, error } = await db.from("contacts").select("id").eq("phone", phone);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) contactIds.add(c.id);
  }
  if (email) {
    const { data, error } = await db.from("contacts").select("id").ilike("email", email);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) contactIds.add(c.id);
  }
  if (contactIds.size === 0) {
    throw new Error(
      `לא נמצא איש קשר עם ${[phone && `הטלפון ${phone}`, email && `האימייל ${email}`].filter(Boolean).join(" או ")}`
    );
  }

  const ids = Array.from(contactIds);

  // ── על מה שילמה ──
  const open: OpenRegistration[] = [];

  const { data: eventRegs, error: eventError } = await db
    .from("event_registrations")
    .select("id, contact_id, events (name)")
    .in("contact_id", ids)
    .in("stage", ["interested", "registered"]);
  if (eventError) throw new Error(eventError.message);
  for (const r of eventRegs ?? []) {
    open.push({
      table: "event_registrations",
      id: r.id,
      contactId: r.contact_id,
      targetName: nameOf(r),
    });
  }

  const { data: courseRegs, error: courseError } = await db
    .from("course_registrations")
    .select("id, contact_id, courses (name)")
    .in("contact_id", ids)
    .in("stage", ["interested", "registered"]);
  if (courseError) throw new Error(courseError.message);
  for (const r of courseRegs ?? []) {
    open.push({
      table: "course_registrations",
      id: r.id,
      contactId: r.contact_id,
      targetName: nameOf(r),
    });
  }

  if (open.length === 0) {
    throw new Error("נמצא איש קשר, אבל אין לו הרשמה פתוחה לאירוע או לקורס");
  }
  if (open.length > 1) {
    const list = open.map((o) => o.targetName).join(", ");
    const hint = payer.productHint ? ` בתשלום מופיע: "${payer.productHint}".` : "";
    throw new Error(
      `יש ${open.length} הרשמות פתוחות (${list}) ואי אפשר לדעת על מה התשלום.${hint} יש לסמן ידנית את הנכונה.`
    );
  }

  // ── עדכון ──
  const match = open[0];
  const { error: updateError } = await db
    .from(match.table)
    .update({ stage: "paid", paid_at: new Date().toISOString() })
    .eq("id", match.id);
  if (updateError) throw new Error(updateError.message);

  const { error: logError } = await db.from("interactions").insert({
    contact_id: match.contactId,
    type: "manual_note",
    content: `התקבל תשלום בגרואו — ${match.targetName}`,
  });
  if (logError) console.error("[grow] רישום ביומן איש הקשר נכשל:", logError.message);

  return match.targetName;
}

/**
 * שם האירוע או הקורס מתוך ה-embed של supabase.
 *
 * הצורה משתנה בין אובייקט למערך לפי מה שהלקוח מסיק, ואנחנו לא נשענים על
 * הטיפוסים האוטומטיים שלו (ראו ההערה על Relationships ב-database.types).
 * "ללא שם" ולא זריקה: שם חסר הוא בעיית תצוגה, לא סיבה לבטל תשלום שהתקבל.
 */
function nameOf(row: unknown): string {
  const value = (row as Record<string, unknown>).events ?? (row as Record<string, unknown>).courses;
  const one = Array.isArray(value) ? value[0] : value;
  const name = (one as { name?: unknown } | null)?.name;
  return typeof name === "string" && name ? name : "ללא שם";
}
