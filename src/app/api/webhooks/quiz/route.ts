import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMessageToContact } from "@/lib/send";
import { buildQuizReportEmail } from "@/lib/quiz-email";
import type { QuizKind } from "@/lib/supabase/database.types";
import {
  quizPayloadSchema,
  usableEmail,
  normalizePhone,
  CHAKRAS,
  type QuizPayload,
} from "@/lib/quiz";

// POST /api/webhooks/quiz — קליטת תוצאות משאלון הצ'אקרות (index.html).
//
// זהו endpoint ציבורי: הוא נקרא מדפדפן של גולש אנונימי, ולכן אי אפשר להגן
// עליו בסוד — כל מפתח שנשתול ב-HTML גלוי בקוד המקור. ההגנה האמיתית היא
// ולידציה קפדנית (src/lib/quiz.ts) והעובדה שהוא כותב בלבד ולא מחזיר מידע.
// QUIZ_WEBHOOK_SECRET הוא אופציונלי ומרתיע סורקים אוטומטיים בלבד; אם תגדירו
// אותו, הוא חייב להופיע גם ב-CONFIG.WEBHOOK_SECRET שבשאלון.
//
// שלושה סוגי רשומות מגיעים לכאן, כולם עם אותו sessionId:
//   anonymous     — בסיום השאלון, בלי פרטים מזהים
//   lead          — אחרי מילוי הטופס, עם פרטי קשר → נוצר/מתעדכן איש קשר
//   booking_click — בלחיצה על "קביעת פגישה"
// הם ממוזגים לשורה אחת ב-quiz_submissions לפי sessionId.
//
// ב-lead, אחרי השמירה, נשלח לנרשם "הדוח המלא על שבע הצ'אקרות" במייל — בדיוק
// מה שהטופס מבטיח. השליחה קורית ב-after(): היא לא על המסלול הקריטי, ותקלה
// ב-Gmail לא אמורה להכשיל את קליטת הליד. מאותה סיבה גם השאילתות של המסלול
// הקריטי לא נוגעות ב-results_email_sent_at: אם 0004 עוד לא רץ, המייל נכשל
// ונרשם בלוג — אבל הליד עצמו נשמר כרגיל.

export const dynamic = "force-dynamic";

/** מקורות מותרים ל-CORS. ריק = כל מקור (השאלון יכול לשבת בכל דומיין). */
function corsHeaders(origin: string | null) {
  const allowed = process.env.QUIZ_ALLOWED_ORIGIN?.trim();
  const value = !allowed || allowed === "*" ? "*" : allowed === origin ? origin : "";
  return {
    "Access-Control-Allow-Origin": value || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Quiz-Secret",
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

  const secret = process.env.QUIZ_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-quiz-secret") !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const raw = await request.json().catch(() => null);
  const parsed = quizPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "invalid payload", details: parsed.error.flatten() }, 400);
  }
  const p = parsed.data;

  const db = supabaseAdmin();

  // ── איש קשר: רק כשיש פרטים אמיתיים ────────────────────────────────────
  let contactId: string | null = null;
  const email = usableEmail(p.email);
  const phone = normalizePhone(p.phone);

  if ((p.type === "lead" || p.type === "booking_click") && (email || phone)) {
    const found = await findOrCreateContact(db, p, email, phone);
    if ("error" in found) return json({ error: found.error }, found.status);
    contactId = found.id;
  }

  // ── שמירת המילוי ───────────────────────────────────────────────────────
  const { data: existing, error: findErr } = await db
    .from("quiz_submissions")
    .select("id, contact_id, kind, booking_clicked_at")
    .eq("session_id", p.sessionId)
    .maybeSingle();
  if (findErr) return json({ error: findErr.message }, 500);

  // נשמר לפני הכתיבה: אחריה השורה כבר מעודכנת, והשוואה מולה תמיד תצא שווה
  const previousKind = existing?.kind;

  const row = {
    session_id: p.sessionId,
    contact_id: contactId ?? existing?.contact_id ?? null,
    // הסוג רק עולה בדרגה: anonymous → lead → booking_click
    kind: strongerKind(existing?.kind, p.type),
    full_name: p.name || null,
    email: email ?? (p.email || null),
    phone: phone ?? (p.phone || null),
    consent: p.consent,
    lowest_chakra: p.lowestChakra ?? null,
    lowest_chakra_name: p.lowestChakraName ?? null,
    scores: p.scores ?? {},
    statuses: p.statuses ?? {},
    answers: p.answers ?? [],
    balance_index: p.balanceIndex ?? null,
    balance_display: p.balanceDisplay ?? null,
    mean_score: p.meanScore ?? null,
    spread: p.spread ?? null,
    source: p.source || null,
    utm: p.utm ?? {},
    booking_clicked_at:
      p.type === "booking_click"
        ? (existing?.booking_clicked_at ?? new Date().toISOString())
        : (existing?.booking_clicked_at ?? null),
  };

  // ברשומה קיימת לא דורסים פרטים שכבר יש בהם ערך עם ריק
  if (existing) {
    for (const k of ["full_name", "email", "phone"] as const) {
      if (!row[k]) delete (row as Record<string, unknown>)[k];
    }
  }

  const { data: submission, error: writeErr } = existing
    ? await db.from("quiz_submissions").update(row).eq("id", existing.id).select("id").single()
    : await db.from("quiz_submissions").insert(row).select("id").single();

  if (writeErr) {
    // שני מילויים במקביל עם אותו sessionId — האינדקס הייחודי תופס את זה
    return json({ error: writeErr.message }, writeErr.code === "23505" ? 409 : 500);
  }

  // ── יומן איש הקשר ──────────────────────────────────────────────────────
  // רק במעבר לשלב חדש, כדי לא להציף את היומן בשליחות חוזרות.
  if (contactId && previousKind !== row.kind) {
    await db.from("interactions").insert({
      contact_id: contactId,
      type: "quiz_submitted",
      content: interactionText(p),
    });
  }

  // ── מייל הדוח המלא ─────────────────────────────────────────────────────
  // רק ל-lead עם איש קשר ומייל תקין. החד-פעמיות נאכפת בתוך sendResultsEmail
  // בעדכון מותנה, ולא בבדיקה כאן — כך אין חלון בין הבדיקה לשליחה, וקליטת
  // הליד לא נשענת בשום צורה על העמודה results_email_sent_at.
  if (p.type === "lead" && contactId && email) {
    after(() => sendResultsEmail(db, submission.id, contactId, p));
  }

  return json({ ok: true, submission_id: submission.id, contact_id: contactId });
}

// ── עזרים ────────────────────────────────────────────────────────────────

/**
 * שולח את "הדוח המלא על שבע הצ'אקרות" לנרשם, פעם אחת בלבד.
 *
 * הסדר כאן מכוון: קודם "תופסים" את הזכות לשלוח בעדכון מותנה
 * (results_email_sent_at is null), ורק אחר כך שולחים. שתי בקשות מקבילות עם
 * אותו sessionId — השנייה לא תתפוס דבר ותצא. אם השליחה נכשלת, מנקים את
 * החותמת בחזרה ל-null כדי שניסיון חוזר יוכל לשלוח, והכישלון נרשם ביומן
 * איש הקשר כדי שיהיה גלוי ב-CRM ולא רק בלוגים.
 */
const REPORT_LOG_PREFIX = "[דוח שאלון צ'אקרות]";

/** האם השגיאה היא "העמודה לא קיימת" — כלומר 0004 עוד לא רץ? */
function isMissingColumn(err: { code?: string; message?: string }): boolean {
  return err.code === "42703" || err.code === "PGRST204" || /results_email_sent_at/.test(err.message ?? "");
}

/**
 * "תופס" את הזכות לשלוח, כדי שאותו אדם לא יקבל את הדוח פעמיים.
 *
 * מסלול ראשי — עדכון מותנה על results_email_sent_at. אטומי: שתי בקשות מקבילות,
 * רק אחת תתפוס. זה המסלול הנכון, והוא פעיל ברגע ש-0004 רץ.
 *
 * מסלול גיבוי — כל עוד העמודה לא קיימת, נשענים על היומן: אם כבר נרשמה שליחת
 * מייל דוח לאיש הקשר הזה בדקות האחרונות, לא שולחים שוב. זה מכסה את מה שקורה
 * בפועל (רענון דף, ניסיון חוזר של הדפדפן, לחיצה על "קביעת פגישה" מיד אחרי
 * הטופס) בלי לחסום לצמיתות מילוי חוזר אמיתי כעבור שבוע. הוא לא אטומי, ולכן
 * בשליחה כפולה ממש-בו-זמנית ייתכן מייל כפול — פער שנסגר כשמריצים את 0004.
 */
async function claimReportSend(db: Db, submissionId: string, contactId: string) {
  const { data, error } = await db
    .from("quiz_submissions")
    .update({ results_email_sent_at: new Date().toISOString() })
    .eq("id", submissionId)
    .is("results_email_sent_at", null)
    .select("id")
    .maybeSingle();

  if (!error) return { ok: !!data, viaColumn: true };

  if (!isMissingColumn(error)) {
    console.error("[quiz] סימון שליחת הדוח נכשל — המייל לא נשלח:", error.message);
    return { ok: false, viaColumn: true };
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent, error: logErr } = await db
    .from("interactions")
    .select("id")
    .eq("contact_id", contactId)
    .eq("type", "email_out")
    .like("content", `${REPORT_LOG_PREFIX}%`)
    .gte("created_at", since)
    .limit(1);

  if (logErr) {
    console.error("[quiz] בדיקת היומן נכשלה — המייל לא נשלח:", logErr.message);
    return { ok: false, viaColumn: false };
  }
  return { ok: !recent?.length, viaColumn: false };
}

async function sendResultsEmail(db: Db, submissionId: string, contactId: string, p: QuizPayload) {
  const mail = buildQuizReportEmail(p);
  if (!mail) return;

  const claim = await claimReportSend(db, submissionId, contactId);
  if (!claim.ok) return; // כבר נשלח, בקשה מקבילה הקדימה, או שהתפיסה נכשלה

  const { data: contact } = await db
    .from("contacts").select("*").eq("id", contactId).maybeSingle();

  const result = contact
    ? await sendMessageToContact({
        contact,
        channel: "email",
        subject: mail.subject,
        body: mail.html,
        logPrefix: REPORT_LOG_PREFIX,
      })
    : { ok: false as const, error: "איש הקשר לא נמצא אחרי היצירה" };

  if (!result.ok) {
    // משחררים את התפיסה כדי שניסיון חוזר יוכל לשלוח. במסלול הגיבוי אין מה
    // לשחרר — לא נרשם email_out, ולכן הבדיקה הבאה ממילא תאפשר שליחה.
    if (claim.viaColumn) {
      await db.from("quiz_submissions").update({ results_email_sent_at: null }).eq("id", submissionId);
    }
    await db.from("interactions").insert({
      contact_id: contactId,
      type: "manual_note",
      content: `שליחת מייל הדוח נכשלה: ${result.error}`,
    });
  }
}

const KIND_RANK: Record<QuizKind, number> = { anonymous: 0, lead: 1, booking_click: 2 };

/** הסוג רק עולה בדרגה — מי שכבר סומן כ"יצא לקבוע פגישה" לא חוזר להיות אנונימי */
function strongerKind(current: QuizKind | undefined, incoming: QuizKind): QuizKind {
  if (!current) return incoming;
  return KIND_RANK[incoming] > KIND_RANK[current] ? incoming : current;
}

function interactionText(p: QuizPayload): string {
  const chakra = p.lowestChakraName ?? (p.lowestChakra ? CHAKRAS[p.lowestChakra].name : "—");
  const score = p.lowestChakra && p.scores ? p.scores[p.lowestChakra] : undefined;
  const head =
    p.type === "booking_click"
      ? `יצא לקבוע פגישה (${p.bookingFrom ?? "מדף התוצאות"})`
      : "מילא את שאלון הצ'אקרות";
  const balance = p.balanceIndex != null ? ` · מדד איזון ${p.balanceIndex}` : "";
  return `${head}. חסומה ביותר: ${chakra}${score != null ? ` (${score}/100)` : ""}${balance}`;
}

type Db = ReturnType<typeof supabaseAdmin>;

/**
 * התאמה לאיש קשר קיים לפי טלפון (ייחודי בסכימה) ואז לפי אימייל.
 * לא נוגעים ב-status של איש קשר קיים — זה שדה שהצוות מנהל ידנית.
 */
async function findOrCreateContact(
  db: Db,
  p: QuizPayload,
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

  const chakraTag = p.lowestChakraName ?? (p.lowestChakra ? CHAKRAS[p.lowestChakra].name : null);
  const newTags = ["שאלון צ'אקרות", ...(chakraTag ? [`חסומה: ${chakraTag}`] : [])];

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
      source: "שאלון צ'אקרות",
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
