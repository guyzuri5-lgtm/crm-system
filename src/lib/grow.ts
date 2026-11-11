import "server-only";

import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "./supabase/admin";
import { kickoffJourneysForContact } from "./journey-engine";
import { normalizePhone, usableEmail } from "./quiz";
import { findOrCreateContact } from "./registration";
import { requestWordPressSync } from "./wordpress";

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
  /**
   * שם המוצר כפי שהופיע בתשלום (paymentDesc בגרואו). משמש להודעות, ולזיהוי
   * האירוע כשהשיוך לפי איש הקשר לבדו אינו חד-משמעי.
   */
  productHint: string | null;
  /** שם המשלם (fullName), ליצירת איש קשר כשמשלם על אירוע בלי לעבור בטופס. */
  fullName: string | null;
}

const EMAIL_KEYS = /mail|מייל|אימייל/i;
// "tel" לבדו היה תופס גם hotel; "telephone" מפורש במקומו.
const PHONE_KEYS = /phone|mobile|cell|telephone|טלפון|נייד/i;
// בלי "name" לבדו — הוא היה תופס customerName והופך את שם הלקוח ל"שם המוצר"
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

  // שני שדות שהמבנה שלהם כבר ידוע מהתשלומים האמיתיים (אוקטובר 2026):
  // paymentDesc הוא שם המוצר, fullName שם המשלם. נקראים ישירות ולא דרך
  // החיפוש — paymentDesc לא נתפס ב-PRODUCT_KEYS, ו-name נשאר מחוץ להם בכוונה.
  const top = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;

  return {
    email: byKey.email ?? byShape.email,
    phone: byKey.phone ?? byShape.phone,
    productHint: text(top.paymentDesc) ?? byKey.product,
    fullName: text(top.fullName),
  };
}

// ── שיוך התשלום להרשמה ─────────────────────────────────────────────────────

interface OpenRegistration {
  table: "event_registrations" | "course_registrations";
  id: string;
  contactId: string;
  /** האירוע או הקורס */
  targetId: string;
  targetName: string;
}

/** השוואת שמות שסולחת על רווחים, מקפים ופיסוק — "סדנה- נשימה" = "סדנה נשימה". */
function sameName(a: string, b: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[\s\-–—_.,:;!?"'״׳()]+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

/**
 * סימון ההרשמה כמשולמת.
 *
 * זורק בכל מקרה שאינו חד-משמעי, וזו החלטה ולא הימנעות: לסמן "שילם" על
 * ההרשמה הלא נכונה גרוע יותר מלא לסמן כלום — הראשון שולח לו חומרים של מוצר
 * שלא קנה ומוציא אותו מרשימת המתעניינים במוצר שכן, והשני משאיר שורה בתיבה
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

  // ── מי שילם ──
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
    // ייתכן ששילם על אירוע ישירות בקישור של גרואו, בלי לעבור בטופס.
    const fromPayment = await registerFromPayment(payer, phone, email);
    if (fromPayment) return fromPayment;
    throw new Error(
      `לא נמצא איש קשר עם ${[phone && `הטלפון ${phone}`, email && `האימייל ${email}`].filter(Boolean).join(" או ")}`
    );
  }

  const ids = Array.from(contactIds);

  // ── על מה שילם ──
  const open: OpenRegistration[] = [];

  const { data: eventRegs, error: eventError } = await db
    .from("event_registrations")
    .select("id, contact_id, event_id, events (name)")
    .in("contact_id", ids)
    .in("stage", ["interested", "registered"]);
  if (eventError) throw new Error(eventError.message);
  for (const r of eventRegs ?? []) {
    open.push({
      table: "event_registrations",
      id: r.id,
      contactId: r.contact_id,
      targetId: r.event_id,
      targetName: nameOf(r),
    });
  }

  const { data: courseRegs, error: courseError } = await db
    .from("course_registrations")
    .select("id, contact_id, course_id, courses (name)")
    .in("contact_id", ids)
    .in("stage", ["interested", "registered"]);
  if (courseError) throw new Error(courseError.message);
  for (const r of courseRegs ?? []) {
    open.push({
      table: "course_registrations",
      id: r.id,
      contactId: r.contact_id,
      targetId: r.course_id,
      targetName: nameOf(r),
    });
  }

  if (open.length === 0) {
    const fromPayment = await registerFromPayment(payer, phone, email);
    if (fromPayment) return fromPayment;
    throw new Error("נמצא איש קשר, אבל אין לו הרשמה פתוחה לאירוע או לקורס");
  }

  // כמה הרשמות פתוחות: שם המוצר בתשלום מכריע, אם הוא תואם בדיוק אחת מהן.
  // עד עכשיו זה היה תמיד "יש לסמן ידנית"; כשהשם לא תואם — עדיין כך.
  if (open.length > 1 && payer.productHint) {
    const byName = open.filter((o) => sameName(o.targetName, payer.productHint!));
    if (byName.length === 1) open.splice(0, open.length, byName[0]);
  }

  // הרשמה פתוחה אחת, אבל התשלום נושא שם של אירוע *אחר*: מי שהשאיר פרטים
  // לקורס ושילם ישירות על סדנה. בלי הבדיקה הזו הקורס היה מסומן כמשולם.
  if (
    open.length === 1 &&
    payer.productHint &&
    !sameName(open[0].targetName, payer.productHint)
  ) {
    const fromPayment = await registerFromPayment(payer, phone, email);
    if (fromPayment) return fromPayment;
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

  // מקום נתפס — מספר המקומות הפנויים באתר יורד. ברקע ולא חוסם.
  if (match.table === "event_registrations") await requestWordPressSync("event", match.targetId);

  // ── המסע יוצא לדרך עכשיו, לא בריצת הקרון הבאה ──────────────────────────
  //
  // זו אותה שורה בדיוק שקיימת בהרשמה (course/[slug]/actions.ts), והיעדרה
  // כאן היה תקלה אמיתית ב-25.9.2026: לקוחה שילמה על הקורס, השורה סומנה
  // 'paid' תוך שניות — ומייל הקישור נשאר תלוי בקרון, כי *רק* הקרון מצרף
  // למסע מסוג course_paid. באותו יום GitHub הריץ את הקרון שש פעמים במקום
  // 96, וההמתנה הפכה משעה לשעות.
  //
  // הלקח אינו "לתקן את הקרון" אלא שמוצר ששולם עליו לא צריך מתזמן כדי
  // להימסר. הקרון נשאר הרשת שמתחת — הוא עדיין יצרף את מי שהשורה הזו
  // פספסה — אבל הוא כבר לא הדרך היחידה.
  //
  // כאן ולא ב-route: לתשלום יש שני שערים — ה-webhook מגרואו, והרצה מחדש
  // מהתיבה בהגדרות (settings/meta-forms/actions.ts). השני הוא בדיוק המסלול
  // שבו גיא משחרר תשלום שנתקע, כלומר המקום שבו שליחה מיידית נחוצה *יותר*.
  // שורה בכל שער פירושה שער אחד שיישכח — וזו בדיוק הטעות שאנחנו מתקנים.
  //
  // after() ולא await: גרואו כבר קיבלה 200, והשליחה קורית אחריה. after
  // מותר גם ב-Route Handler וגם ב-Server Function, ולכן הוא תקף בשניהם.
  after(() => kickoffJourneysForContact(match.contactId));

  return match.targetName;
}

/**
 * תשלום על אירוע בלי הרשמה פתוחה — מי שלחץ על קישור גרואו ישירות.
 *
 * רק כשהשם בתשלום תואם בדיוק אירוע פעיל אחד. אחרת מחזיר null והתשלום נשאר
 * בתיבה כמו קודם. קורסים לא נכנסים לכאן בכוונה: תהליך הרכישה שלהם עובר
 * בטופס ועובד, ואין סיבה לגעת בו.
 *
 * תופס מקום גם כשהאירוע מלא: הכסף כבר התקבל, וזה מה שגיא צריך לראות.
 */
async function registerFromPayment(
  payer: GrowPayer,
  phone: string | null,
  email: string | null
): Promise<string | null> {
  if (!payer.productHint) return null;
  const db = supabaseAdmin();

  const { data: events, error } = await db.from("events").select("id, name").eq("active", true);
  if (error) throw new Error(error.message);
  const matches = (events ?? []).filter((e) => sameName(e.name, payer.productHint!));
  if (matches.length !== 1) return null;
  const event = matches[0];

  const contact = await findOrCreateContact(
    db,
    { fullName: payer.fullName ?? "", phone: phone ?? "", email: email ?? "" },
    `אירוע: ${event.name}`
  );
  if ("error" in contact) throw new Error(contact.error);

  // insert ולא upsert: אם כבר יש לו הרשמה לאירוע הזה, היא בהכרח 'paid'
  // (פתוחה הייתה נתפסת קודם), כלומר זה תשלום שני — כרטיס נוסף או חיוב כפול.
  // את זה גיא מכריע, ולכן התשלום נשאר בתיבה.
  const { error: insertError } = await db.from("event_registrations").insert({
    event_id: event.id,
    contact_id: contact.id,
    stage: "paid",
    source: "grow",
    paid_at: new Date().toISOString(),
  });
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error(`כבר רשום כמשלם לאירוע "${event.name}" — תשלום שני? יש לבדוק ידנית.`);
    }
    throw new Error(insertError.message);
  }

  const { error: logError } = await db.from("interactions").insert({
    contact_id: contact.id,
    type: "event_registered",
    content: `שילם בגרואו ונרשם לאירוע: ${event.name}`,
  });
  if (logError) console.error("[grow] רישום ביומן איש הקשר נכשל:", logError.message);

  await requestWordPressSync("event", event.id);
  after(() => kickoffJourneysForContact(contact.id));

  return event.name;
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
