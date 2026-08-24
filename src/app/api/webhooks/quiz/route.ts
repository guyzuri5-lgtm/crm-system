import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

  return json({ ok: true, submission_id: submission.id, contact_id: contactId });
}

// ── עזרים ────────────────────────────────────────────────────────────────

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
