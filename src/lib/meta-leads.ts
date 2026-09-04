import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { findOrCreateContact, strongerStage } from "./registration";
import { assertInboxMigrated } from "./webhook-inbox";
import { normalizePhone, usableEmail } from "./quiz";
import { verifyMetaChallenge, verifyMetaSignature } from "./meta-webhook";
import { getEventById } from "./events";
import { getCourseById } from "./courses";
import type { MetaFormTarget } from "./supabase/database.types";

/**
 * קליטת לידים מטפסי הפרסום של מטא (Lead Ads), שלב 6.
 *
 * שלוש עובדות על ה-webhook הזה מסבירות כמעט כל שורה בקובץ:
 *
 *   1. **מטא לא שולחת את התשובות.** ה-webhook מכיל מזהה ליד בלבד, ואת התוכן
 *      צריך לשלוף בקריאה נפרדת ל-Graph API עם טוקן דף שיש לו leads_retrieval.
 *   2. **שמות השדות נקבעים על ידי מי שבנה את הטופס.** אין סכימה: אותו שדה
 *      יגיע כ-full_name בטופס אחד וכ-"שם מלא" בטופס הבא. לכן החילוץ כאן
 *      סלחני ומסתמך גם על *צורת הערך* ולא רק על שמו.
 *   3. **מזהה הטופס לא אומר לאן הליד שייך.** השיוך לאירוע או לקורס נשמר
 *      בטבלת meta_form_targets, ובלעדיו אין לנו לאן לרשום את הלקוחה.
 */

// גרסת Graph API. מיושרת לזו שבלקוח הוואטסאפ, ומאותה סיבה — היא מה שהקונסולה
// של מטא מייצרת בדוגמאות שלה. אפשר לדרוס דרך META_API_VERSION.
const DEFAULT_API_VERSION = "v25.0";

// ── אימות ──────────────────────────────────────────────────────────────────

/** GET של ההרשמה. טוקן נפרד משל וואטסאפ — שני webhooks, שני אימותים. */
export function verifyLeadsChallenge(params: URLSearchParams): string | null {
  return verifyMetaChallenge(params, process.env.META_LEADS_VERIFY_TOKEN);
}

/**
 * החתימה על גוף הבקשה.
 *
 * ה-App Secret הוא של *האפליקציה* במטא ולא של מוצר מסוים בתוכה, ולכן אם
 * הלידים יושבים באותה אפליקציה כמו הוואטסאפ — וכך זה אצלנו — זה אותו סוד
 * בדיוק. META_APP_SECRET קיים כדי לאפשר הפרדה בעתיד בלי לשנות קוד.
 */
export function verifyLeadsSignature(rawBody: string, header: string | null): boolean {
  return verifyMetaSignature(
    rawBody,
    header,
    process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET
  );
}

// ── מבנה ה-webhook ─────────────────────────────────────────────────────────

/**
 * הכל אופציונלי, כמו ב-WhatsAppWebhook ומאותה סיבה: אותו endpoint מקבל גם
 * אירועים שאיננו מטפלים בהם, וטיפוס נוקשה היה נשבר על הראשון שבהם.
 */
export interface MetaLeadsWebhook {
  object?: string;
  entry?: {
    id?: string;
    time?: number;
    changes?: {
      field?: string;
      value?: {
        leadgen_id?: string | number;
        form_id?: string | number;
        page_id?: string | number;
        created_time?: number;
        /** לא מגיע ממטא האמיתית — ראו parseLeadgenEvents */
        field_data?: MetaFieldEntry[];
      };
    }[];
  }[];
}

export interface MetaFieldEntry {
  name?: string;
  values?: unknown[];
}

export interface LeadgenEvent {
  leadgenId: string | null;
  formId: string | null;
  /**
   * התשובות, אם הן הגיעו בתוך ה-webhook.
   *
   * מטא עצמה לא שולחת אותן אף פעם — אבל בדיקות ידניות עם curl כן, וכך גם
   * חלק מכלי הבדיקה. קליטה שלהן כאן היא מה שמאפשר לבדוק את כל השרשרת בלי
   * טוקן דף ובלי ליד אמיתי.
   */
  fieldData: MetaFieldEntry[] | null;
}

/** שליפת אירועי leadgen מתוך ה-payload, בלי להניח שיש בו רק אותם. */
export function parseLeadgenEvents(payload: MetaLeadsWebhook): LeadgenEvent[] {
  const events: LeadgenEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = change.value ?? {};
      events.push({
        leadgenId: value.leadgen_id != null ? String(value.leadgen_id) : null,
        formId: value.form_id != null ? String(value.form_id) : null,
        fieldData: Array.isArray(value.field_data) ? value.field_data : null,
      });
    }
  }
  return events;
}

// ── שליפת התשובות מ-Graph ──────────────────────────────────────────────────

/**
 * התוכן של ליד אחד.
 *
 * זורק עם הודעה בעברית ולא מחזיר null: הקורא כותב את ההודעה הזו לתוך
 * webhook_inbox.error, וזה מה שגיא יראה במסך ההגדרות. "נכשל" בלי סיבה היה
 * מחזיר אותנו בדיוק למצב שהתיבה נועדה למנוע.
 */
export async function fetchLeadFields(leadgenId: string): Promise<MetaFieldEntry[]> {
  const token = process.env.META_LEADS_PAGE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "META_LEADS_PAGE_TOKEN לא מוגדר — אי אפשר לשלוף את פרטי הליד ממטא. הליד נשמר בתיבה וניתן לעבד אותו אחרי הגדרת הטוקן."
    );
  }

  const version = process.env.META_API_VERSION || DEFAULT_API_VERSION;
  const response = await fetch(
    `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}?fields=field_data,form_id,created_time`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`שליפת הליד ממטא נכשלה: ${detail}`);
  }

  const fieldData = (body as { field_data?: unknown } | null)?.field_data;
  if (!Array.isArray(fieldData)) {
    throw new Error("התשובה ממטא לא הכילה field_data");
  }
  return fieldData as MetaFieldEntry[];
}

// ── חילוץ סלחני ────────────────────────────────────────────────────────────

/** הערך הראשון שיש בו תוכן. מטא שולחת מערך גם לשדה עם תשובה אחת. */
function firstValue(entry: MetaFieldEntry): string {
  for (const v of entry.values ?? []) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

/** האם שם השדה מכיל אחת המילים. השוואה בלי רישיות ובלי קווים תחתונים. */
function nameHas(entry: MetaFieldEntry, words: string[]): boolean {
  const name = (entry.name ?? "").toLowerCase().replace(/[_-]+/g, " ");
  return words.some((w) => name.includes(w));
}

export interface MetaRegistrant {
  fullName: string;
  phone: string;
  email: string;
}

/**
 * שם, טלפון ואימייל מתוך field_data.
 *
 * שני מעברים, והסדר ביניהם הוא כל העניין:
 *   1. **לפי שם השדה** — מדויק כשהטופס בנוי בשמות המוכרים של מטא או בעברית.
 *   2. **לפי צורת הערך** — הרשת שתופסת את השאר. שדה שנקרא "question_1"
 *      ומכיל "dana@gmail.com" הוא אימייל, גם אם שמו לא מסגיר דבר.
 *
 * המעבר השני הוא מה שהופך את הקליטה לעמידה בפני טופס חדש שגיא יבנה מחר בלי
 * לספר לאף אחד — וזה המצב הנפוץ, לא החריג.
 */
export function extractRegistrant(fieldData: MetaFieldEntry[]): MetaRegistrant {
  let fullName = "";
  let firstName = "";
  let lastName = "";
  let phone = "";
  let email = "";

  for (const entry of fieldData) {
    const value = firstValue(entry);
    if (!value) continue;

    if (!email && nameHas(entry, ["email", "mail", "מייל", "אימייל", "דוא"])) email = value;
    else if (!phone && nameHas(entry, ["phone", "mobile", "טלפון", "נייד", "פלאפון"])) phone = value;
    else if (!fullName && nameHas(entry, ["full name", "fullname", "שם מלא"])) fullName = value;
    else if (!firstName && nameHas(entry, ["first name", "firstname", "שם פרטי"])) firstName = value;
    else if (!lastName && nameHas(entry, ["last name", "lastname", "שם משפחה"])) lastName = value;
    else if (!fullName && nameHas(entry, ["name", "שם"])) fullName = value;
  }

  // מעבר שני: מה שלא זוהה לפי שם, מזוהה לפי הערך עצמו.
  for (const entry of fieldData) {
    const value = firstValue(entry);
    if (!value) continue;
    if (!email && usableEmail(value)) email = value;
    else if (!phone && normalizePhone(value)) phone = value;
  }

  if (!fullName) fullName = [firstName, lastName].filter(Boolean).join(" ");

  return { fullName: fullName.slice(0, 120), phone: phone.slice(0, 20), email: email.slice(0, 160) };
}

// ── שיוך הטופס ליעד ────────────────────────────────────────────────────────

export interface ResolvedFormTarget {
  type: MetaFormTarget["target_type"];
  id: string;
  /** שם האירוע או הקורס. משמש כמקור וכתגית על איש הקשר. */
  name: string;
}

/**
 * לאיזה אירוע או קורס שייך הטופס.
 *
 * null בשני מצבים שונים לגמרי, ושניהם מכוונים: אין שיוך כלל, או שהשיוך מצביע
 * על יעד שנמחק. שניהם מסתיימים באותו מקום — הליד נשאר בתיבה עם הסבר — ולכן
 * אין ערך בהבחנה ביניהם *כאן*; ההבחנה נעשית בהודעה שהקורא כותב.
 */
export async function resolveFormTarget(formId: string): Promise<ResolvedFormTarget | null> {
  const { data, error } = await supabaseAdmin()
    .from("meta_form_targets")
    .select("form_id, target_type, target_id")
    .eq("form_id", formId)
    .maybeSingle();
  // בלי זה, ליד שמגיע לפני שהמיגרציה הורצה היה נשמר בתיבה עם ההודעה הגולמית
  // של PostgREST — נכונה טכנית וחסרת תועלת למי שקורא אותה במסך.
  assertInboxMigrated(error);
  if (error) throw new Error(error.message);
  if (!data) return null;

  if (data.target_type === "event") {
    const event = await getEventById(data.target_id);
    return event ? { type: "event", id: event.id, name: event.name } : null;
  }
  const course = await getCourseById(data.target_id);
  return course ? { type: "course", id: course.id, name: course.name } : null;
}

// ── עיבוד ליד יחיד ─────────────────────────────────────────────────────────

/**
 * זורק עם הודעה בעברית בכל כישלון. ההודעה אינה חוזרת למטא (שמקבלת 200 בכל
 * מקרה) אלא נכתבת ל-webhook_inbox.error — כלומר היא נכתבת לגיא, והיא צריכה
 * לומר לו מה *לעשות*, לא רק מה קרה.
 */
export async function processLeadgenEvent(event: LeadgenEvent): Promise<void> {
  if (!event.formId) throw new Error("ה-payload לא כלל מזהה טופס (form_id)");

  const target = await resolveFormTarget(event.formId);
  if (!target) {
    throw new Error(
      "הטופס אינו משויך לאירוע או לקורס (או שהיעד נמחק). יש לשייך אותו בהגדרות ← טפסי מטא, ואז לעבד את השורה מחדש."
    );
  }

  // מטא לא שולחת את התשובות ב-webhook — הן נשלפות בקריאה נפרדת. field_data
  // בתוך ה-payload מגיע רק מבדיקה ידנית, וזה מה שמאפשר לבדוק בלי טוקן דף.
  let fieldData: MetaFieldEntry[];
  if (event.fieldData) {
    fieldData = event.fieldData;
  } else if (event.leadgenId) {
    fieldData = await fetchLeadFields(event.leadgenId);
  } else {
    throw new Error("ה-payload לא כלל מזהה ליד (leadgen_id) ולא את התשובות עצמן");
  }

  const registrant = extractRegistrant(fieldData);
  if (!registrant.phone && !registrant.email) {
    throw new Error("לא נמצאו טלפון או אימייל בתשובות הטופס");
  }

  const db = supabaseAdmin();
  const label = target.type === "event" ? "אירוע" : "קורס";

  const contact = await findOrCreateContact(db, registrant, `${label}: ${target.name}`);
  if ("error" in contact) throw new Error(contact.error);

  // התשובות נשמרות כפי שמטא שלחה אותן, לפי שמות השדות שלה. הן לא בהכרח
  // תואמות את custom_fields של האירוע ולכן לא כולן יוצגו במסך — אבל שורת
  // ההרשמה היא המקום שבו הן שייכות, ולא רק ה-payload הגולמי בתיבה.
  const answers: Record<string, string> = {};
  for (const entry of fieldData) {
    const key = (entry.name ?? "").trim();
    if (!key) continue;
    const value = (entry.values ?? [])
      .filter((v) => typeof v === "string" || typeof v === "number")
      .join(", ")
      .slice(0, 500);
    if (value) answers[key] = value;
  }

  if (target.type === "event") {
    await upsertEventRegistration(db, target.id, contact.id, answers);
  } else {
    await upsertCourseRegistration(db, target.id, contact.id, answers);
  }

  // ביומן איש הקשר. הסוג הוא event_registered/course_registered כי אלה הערכים
  // שקיימים ב-enum, והנוסח הוא מה שמבחין: ליד ממטא הוא *התעניינות* ולא הרשמה
  // שהושלמה. הוספת ערך חדש ל-enum הייתה דורשת מיגרציה נפרדת משלה (ראו 0028),
  // ולא היא שתשנה את מה שקורא היומן מבין.
  const { error: logError } = await db.from("interactions").insert({
    contact_id: contact.id,
    type: target.type === "event" ? "event_registered" : "course_registered",
    content: `הגיעה כליד מטופס במטא — ${label}: ${target.name}`,
  });
  if (logError) console.error("[meta-leads] רישום ביומן איש הקשר נכשל:", logError.message);
}

type Db = ReturnType<typeof supabaseAdmin>;

/**
 * שתי הפונקציות הבאות זהות בלוגיקה ונפרדות בקוד, כי הן כותבות לשתי טבלאות
 * שונות והלקוח המוטפס של supabase לא מקבל שם טבלה כמשתנה. איחוד שלהן היה
 * דורש לוותר על הטיפוסים בדיוק במקום שבו הם שווים משהו.
 *
 * השלב הוא interested ועולה בדרגה בלבד: ליד ממטא שכבר נרשמה או שילמה בדף
 * ההרשמה לא תוחזר אחורה למתעניינת. המסע שמיועד למתעניינות נשען על השדה הזה.
 */
async function upsertEventRegistration(
  db: Db,
  eventId: string,
  contactId: string,
  answers: Record<string, string>
): Promise<void> {
  const { data: existing, error: findError } = await db
    .from("event_registrations")
    .select("id, stage, answers")
    .eq("event_id", eventId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const stage = strongerStage(existing?.stage, "interested");
  const { error } = existing
    ? await db
        .from("event_registrations")
        .update({ stage, answers: { ...existing.answers, ...answers } })
        .eq("id", existing.id)
    : await db
        .from("event_registrations")
        .insert({ event_id: eventId, contact_id: contactId, stage, source: "meta", answers });

  // 23505 = אותו ליד נשלח פעמיים במקביל. הרישום קיים, וזה בדיוק מה שרצינו.
  if (error && error.code !== "23505") throw new Error(error.message);
}

async function upsertCourseRegistration(
  db: Db,
  courseId: string,
  contactId: string,
  answers: Record<string, string>
): Promise<void> {
  const { data: existing, error: findError } = await db
    .from("course_registrations")
    .select("id, stage, answers")
    .eq("course_id", courseId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  const stage = strongerStage(existing?.stage, "interested");
  const { error } = existing
    ? await db
        .from("course_registrations")
        .update({ stage, answers: { ...existing.answers, ...answers } })
        .eq("id", existing.id)
    : await db
        .from("course_registrations")
        .insert({ course_id: courseId, contact_id: contactId, stage, source: "meta", answers });

  if (error && error.code !== "23505") throw new Error(error.message);
}
