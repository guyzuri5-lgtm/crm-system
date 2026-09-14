import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

// POST /api/webhooks/quiz/progress — דיווח נשירה משאלון הצ'אקרות.
//
// נפרד מ-/api/webhooks/quiz בכוונה. שם נקלטת תוצאה מלאה, והסכמה דורשת
// ציונים ומרכז חסום; כאן מגיע בדיוק ההפך — מישהו שלא סיים, ואין לו כלום
// חוץ ממספר הצעד שאליו הגיע. דחיפת שני הדברים לאותה סכמה הייתה מחייבת
// לרופף את הוולידציה של המסלול שכן עובד.
//
// הקריאה מגיעה מ-navigator.sendBeacon ברגע שהדף נסגר. לכן:
//   · התשובה חייבת להיות מהירה וזולה — הדפדפן כבר בדרך החוצה.
//   · אי אפשר להסתמך על כותרות: beacon שולח Blob, ולפעמים בלי Content-Type.
//   · לעולם לא מחזירים שגיאה שתגרום לדפדפן לנסות שוב. תמיד 204.
//
// אין כאן שום פרט מזהה — רק ה-sessionId האקראי של המילוי.

export const dynamic = "force-dynamic";

function corsHeaders(origin: string | null) {
  const allowed = process.env.QUIZ_ALLOWED_ORIGIN?.trim();
  const value = !allowed || allowed === "*" ? "*" : allowed === origin ? origin : "";
  return {
    "Access-Control-Allow-Origin": value || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

const progressSchema = z.object({
  sessionId: z.string().min(6).max(100),
  reachedStep: z.number().int().min(0).max(500),
  totalSteps: z.number().int().min(0).max(500),
  reachedLabel: z.string().max(200).optional().default(""),
  completed: z.boolean().optional().default(false),
  source: z.string().max(500).optional().default(""),
  utm: z.record(z.string().max(40), z.string().max(300)).optional().default({}),
});

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  const done = () => new NextResponse(null, { status: 204, headers: cors });

  // beacon לא תמיד מציין Content-Type, ולכן קוראים טקסט ומפענחים ידנית
  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
  } catch {
    return done();
  }

  const p = progressSchema.safeParse(parsed);
  if (!p.success) return done();

  const db = supabaseAdmin();

  // הצעד רק עולה. ביקון שני מאותו מילוי עלול להגיע עם ערך נמוך יותר —
  // למשל אם המשתמש חזר אחורה — ואסור לו למחוק את השיא שכבר נרשם.
  const { data: existing } = await db
    .from("quiz_progress")
    .select("reached_step, reached_label, completed")
    .eq("session_id", p.data.sessionId)
    .maybeSingle();

  // התווית חייבת לתאר את הצעד שנשמר בפועל. ביקון שמגיע עם ערך נמוך יותר
  // אינו מוריד את reached_step — ואם היינו לוקחים ממנו את התווית, הדוח היה
  // מציג "צעד 7 · היגד 1" ושולח לתקן את השאלה הלא נכונה.
  const advances = p.data.reachedStep >= (existing?.reached_step ?? -1);

  const row = {
    session_id: p.data.sessionId,
    reached_step: Math.max(p.data.reachedStep, existing?.reached_step ?? 0),
    total_steps: p.data.totalSteps,
    reached_label: advances
      ? p.data.reachedLabel || null
      : (existing?.reached_label ?? null),
    completed: p.data.completed || existing?.completed || false,
    source: p.data.source || null,
    utm: p.data.utm,
    updated_at: new Date().toISOString(),
  };

  // שגיאה נבלעת בכוונה: זה מונה, ולא שווה להחזיר כשל לדפדפן שכבר נסגר
  await db.from("quiz_progress").upsert(row, { onConflict: "session_id" });

  return done();
}
