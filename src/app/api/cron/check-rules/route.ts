import { NextRequest, NextResponse } from "next/server";
import { runTimeSinceNoReplyRules } from "@/lib/automation-engine";

// GET /api/cron/check-rules — per spec section 4, runs once a day (see vercel.json).
// Vercel Cron always calls with GET, and automatically sends
// `Authorization: Bearer $CRON_SECRET` when a CRON_SECRET env var is set on the
// project — set one and this route (and only Vercel's own scheduler) can call it.
export const dynamic = "force-dynamic";

// Pro מאפשר עד 300 שניות; Hobby חוסם ב-60 בלי קשר למה שכתוב כאן. הערך גבוה
// בכוונה — שליחות הוואטסאפ מושהות ביניהן (ראו whatsapp-throttle.ts), וכל שנייה
// כאן היא עוד הודעה שנכנסת לריצה הזו במקום להידחות למחר.
export const maxDuration = 300;

/**
 * שולי הביטחון בין תקציב הריצה לבין הזמן שבו Vercel קוטע את הפונקציה בכוח.
 *
 * הקטיעה אינה מנומסת: אין onShutdown ואין הזדמנות לסיים. השוליים האלה הם מה
 * שמבטיח שהלולאה תעצור מרצון, תרשום את מה שנשלח, ותחזיר תשובה — במקום להיעלם
 * באמצע הודעה.
 */
const SAFETY_MARGIN_MS = 15_000;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const summary = await runTimeSinceNoReplyRules(
    new Date(),
    maxDuration * 1000 - SAFETY_MARGIN_MS
  );
  const failed = summary.results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    checked_at: new Date().toISOString(),
    sent: summary.results.length - failed.length,
    failed: failed.length,
    // מה שלא נשלח בריצה הזו ייתפס בריצה הבאה — automation_rule_runs מבטיח
    // שמי שכן קיבל לא יקבל שוב.
    skipped: summary.skipped,
    stopped: summary.stopped,
    remaining_today: summary.remainingToday,
    errors: failed,
  });
}
