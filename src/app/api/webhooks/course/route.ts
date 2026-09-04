import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  coursePayloadSchema,
  usableEmail,
  normalizePhone,
  type CoursePayload,
} from "@/lib/course";
import { getLegacyCourse } from "@/lib/courses";

// POST /api/webhooks/course — קליטת לידים מדף הנחיתה של קורס המדיטציה.
//
// זהו endpoint ציבורי: הוא נקרא מדפדפן של גולש אנונימי, ולכן אי אפשר להגן
// עליו בסוד — כל מפתח שנשתול ב-HTML גלוי בקוד המקור. ההגנה האמיתית היא
// ולידציה קפדנית (src/lib/course.ts) והעובדה שהוא כותב בלבד ולא מחזיר מידע.
// COURSE_WEBHOOK_SECRET הוא אופציונלי ומרתיע סורקים אוטומטיים בלבד; אם
// תגדירו אותו, הוא חייב להופיע גם ב-CONFIG.WEBHOOK_SECRET שבדף הנחיתה.
//
// שני סוגי רשומות מגיעים לכאן, שניהם עם אותו sessionId:
//   lead          — אחרי מילוי הטופס, עם פרטי קשר → נוצר/מתעדכן איש קשר
//   payment_click — בלחיצה על "מעבר לתשלום"
// הם ממוזגים לשורה אחת ב-course_leads לפי sessionId.

export const dynamic = "force-dynamic";

/** מקורות מותרים ל-CORS. ריק = כל מקור (הדף יכול לשבת בכל דומיין). */
function corsHeaders(origin: string | null) {
  const allowed = process.env.COURSE_ALLOWED_ORIGIN?.trim();
  const value = !allowed || allowed === "*" ? "*" : allowed === origin ? origin : "";
  return {
    "Access-Control-Allow-Origin": value || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Course-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

  const secret = process.env.COURSE_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-course-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const raw = await request.json().catch(() => null);
  const parsed = coursePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid payload", details: parsed.error.flatten() }, 400);
  }
  const p = parsed.data;

  const db = supabaseAdmin();

  // ── איש קשר: רק כשיש פרטים אמיתיים ────────────────────────────────────
  let contactId: string | null = null;
  const email = usableEmail(p.email);
  const phone = normalizePhone(p.phone);

  if (email || phone) {
    const found = await findOrCreateContact(db, p, email, phone);
    if ("error" in found) return json({ error: found.error }, found.status);
    contactId = found.id;
  }

  // ── שמירת הליד ─────────────────────────────────────────────────────────
  const { data: existing, error: findErr } = await db
    .from("course_leads")
    .select("id, contact_id, kind, consent, consent_at, payment_clicked_at")
    .eq("session_id", p.sessionId)
    .maybeSingle();
  if (findErr) return json({ error: findErr.message }, 500);

  const previousKind = existing?.kind;
  const now = new Date().toISOString();

  // ההסכמה נשמרת עם חותמת זמן משלה, וזו הראיה מתי היא ניתנה. לכן
  // consent_at לא מתחדש בכל בקשה — רק כשההסכמה עוברת משלילית לחיובית.
  // ביטול הסכמה מאפס אותה, כי מאותו רגע אין יותר על מה להסתמך.
  const consentAt = p.consent ? (existing?.consent ? existing.consent_at : now) : null;

  const row = {
    session_id: p.sessionId,
    contact_id: contactId ?? existing?.contact_id ?? null,
    // הסוג רק עולה בדרגה: lead → payment_click
    kind: strongerKind(existing?.kind, p.type),
    full_name: p.name || null,
    email: email ?? (p.email || null),
    phone: phone ?? (p.phone || null),
    consent: p.consent,
    consent_at: consentAt,
    source: p.source || null,
    utm: p.utm ?? {},
    payment_clicked_at:
      p.type === "payment_click"
        ? (existing?.payment_clicked_at ?? now)
        : (existing?.payment_clicked_at ?? null),
  };

  // ברשומה קיימת לא דורסים פרטים שכבר יש בהם ערך עם ריק. הלחיצה על
  // "מעבר לתשלום" נשלחת בלי השדות של הטופס, ובלי זה היא הייתה מוחקת את
  // השם, המייל והטלפון שנקלטו רגע קודם.
  if (existing) {
    for (const k of ["full_name", "email", "phone"] as const) {
      if (!row[k]) delete (row as Record<string, unknown>)[k];
    }

    // ואותו נימוק עצמו חל על ההסכמה, ביתר שאת. consent הוא ברירת מחדל false
    // בסכימה, ובקשת payment_click נשלחת בלי הטופס — כלומר false בה אינה
    // "ביטול הסכמה" אלא היעדר מידע. בלי החרגה כאן, מי שסימן אישור ואז לחץ
    // "מעבר לתשלום" היה מאבד את consent_at — הראיה מתי ההסכמה ניתנה, על
    // הלקוח שהגיע הכי רחוק. ביטול אמיתי מגיע רק בשליחת טופס (type=lead).
    if (p.type === "payment_click") {
      delete (row as Record<string, unknown>).consent;
      delete (row as Record<string, unknown>).consent_at;
    }
  }

  const { data: lead, error: writeErr } = existing
    ? await db.from("course_leads").update(row).eq("id", existing.id).select("id").single()
    : await db.from("course_leads").insert(row).select("id").single();

  if (writeErr) {
    // שתי השארות במקביל עם אותו sessionId — האינדקס הייחודי תופס את זה
    return json({ error: writeErr.message }, writeErr.code === "23505" ? 409 : 500);
  }

  // ── יומן איש הקשר ──────────────────────────────────────────────────────
  // רק במעבר לשלב חדש, כדי לא להציף את היומן בשליחות חוזרות.
  if (contactId && previousKind !== row.kind) {
    await db.from("interactions").insert({
      contact_id: contactId,
      type: "course_lead",
      content: interactionText(p),
    });
  }

  // ── הגשר למבנה החדש (0028) ─────────────────────────────────────────────
  // אם סומן קורס כ"מקבל לידים מהדף הישן", הליד נרשם גם כמתעניין בו — וכך
  // הוא נכנס למונים, למסעות ולמסך הקורס. ה-webhook הזה עצמו לא השתנה
  // בשום צורה אחרת, והוא ממשיך לעבוד בדיוק כמו קודם גם בלי קורס מסומן.
  if (contactId) await linkToLegacyCourse(db, contactId);

  return json({ ok: true, lead_id: lead.id, contact_id: contactId });
}

/**
 * רישום הליד כמתעניין בקורס המסומן, אם יש כזה.
 *
 * **לא מחזירה שגיאה לקורא, בכוונה.** הקליטה עצמה כבר הצליחה ונשמרה; כישלון
 * של החיבור הנלווה — מיגרציה שטרם רצה, קורס שנמחק באמצע — אינו סיבה להחזיר
 * שגיאה לדף הנחיתה ולגרום לו להציג ללקוחה שההרשמה נכשלה. הוא כן נרשם ללוג,
 * כי כישלון שקט לחלוטין הוא בדיוק הדפוס שהסתיר את חוסר ה-enum ב-0025.
 *
 * השלב הוא interested ולא registered: השארת פרטים בדף הנחיתה אינה הרשמה
 * לקורס, והיא בדיוק הקהל שהמסע למתעניינות מדבר אליו.
 */
async function linkToLegacyCourse(db: Db, contactId: string): Promise<void> {
  const course = await getLegacyCourse();
  if (!course) return;

  const { error } = await db.from("course_registrations").insert({
    course_id: course.id,
    contact_id: contactId,
    stage: "interested",
    source: "legacy",
  });

  // 23505 = כבר רשום לקורס הזה. זה המצב הרגיל בליד חוזר, ולא שגיאה:
  // השלב לא יורד בדרגה, ומי שכבר שילמה לא חוזרת להיות מתעניינת.
  if (error && error.code !== "23505") {
    console.error("[course] חיבור הליד לקורס המסומן נכשל:", error.message);
  }
}

// ── עזרים ────────────────────────────────────────────────────────────────

const KIND_RANK: Record<CoursePayload["type"], number> = { lead: 0, payment_click: 1 };

/** הסוג רק עולה בדרגה — מי שכבר יצא לתשלום לא חוזר להיות ליד רגיל */
function strongerKind(
  current: string | undefined,
  incoming: CoursePayload["type"]
): CoursePayload["type"] {
  if (!current) return incoming;
  const cur = current as CoursePayload["type"];
  return KIND_RANK[incoming] > (KIND_RANK[cur] ?? -1) ? incoming : cur;
}

function interactionText(p: CoursePayload): string {
  // ההסכמה מדווחת רק על שליחת טופס. ב-payment_click השדה לא נשלח כלל, ולכן
  // "לא אישר קבלת דיוור" שם היה קביעה שאין לה כיסוי — ומטעה במיוחד ביומן
  // שהצוות קורא כדי להחליט למי מותר לשלוח.
  if (p.type === "payment_click") return "יצא לעמוד התשלום של קורס המדיטציה.";

  const consent = p.consent ? "אישר קבלת דיוור" : "לא אישר קבלת דיוור";
  return `השאיר פרטים בדף הנחיתה של קורס המדיטציה. ${consent}.`;
}

type Db = ReturnType<typeof supabaseAdmin>;

/**
 * התאמה לאיש קשר קיים לפי טלפון (ייחודי בסכימה) ואז לפי אימייל.
 * לא נוגעים ב-status של איש קשר קיים — זה שדה שהצוות מנהל ידנית.
 */
async function findOrCreateContact(
  db: Db,
  p: CoursePayload,
  email: string | null,
  phone: string | null
): Promise<{ id: string } | { error: string; status: number }> {
  let existing: { id: string; full_name: string | null; email: string | null; tags: string[] } | null = null;

  if (phone) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").eq("phone", phone).maybeSingle();
    if (error) return { error: error.message, status: 500 };
    existing = data;
  }
  if (!existing && email) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").ilike("email", email).limit(1);
    if (error) return { error: error.message, status: 500 };
    existing = data?.[0] ?? null;
  }

  const newTags = ["קורס מדיטציה", ...(p.consent ? ["אישר דיוור"] : [])];

  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), ...newTags]));
    const { error } = await db
      .from("contacts")
      .update({
        full_name: existing.full_name ?? (p.name || null),
        email: existing.email ?? email,
        tags,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message, status: 500 };
    return { id: existing.id };
  }

  const { data, error } = await db
    .from("contacts")
    .insert({
      full_name: p.name || null,
      phone,
      email,
      source: "קורס מדיטציה",
      tags: newTags,
    })
    .select("id")
    .single();

  if (error) {
    // מרוץ: מישהו יצר את אותו טלפון בין הבדיקה לכתיבה
    if (error.code === "23505" && phone) {
      const { data: retry } = await db.from("contacts").select("id").eq("phone", phone).maybeSingle();
      if (retry) return { id: retry.id };
    }
    return { error: error.message, status: error.code === "23505" ? 409 : 500 };
  }
  return { id: data.id };
}
