import { NextRequest, NextResponse } from "next/server";
import { runTimeSinceNoReplyRules } from "@/lib/automation-engine";
import { runJourneys } from "@/lib/journey-engine";

// GET /api/cron/check-rules — per spec section 4, runs once a day (see vercel.json).
// Vercel Cron always calls with GET, and automatically sends
// `Authorization: Bearer $CRON_SECRET` when a CRON_SECRET env var is set on the
// project — set one and this route (and only Vercel's own scheduler) can call it.
export const dynamic = "force-dynamic";

// Pro מאפשר עד 300 שניות; Hobby קוטע ב-60 **בלי קשר למה שכתוב כאן**.
export const maxDuration = 300;

/**
 * תקציב הריצה בפועל, בשניות.
 *
 * למה זה לא נגזר מ-maxDuration: maxDuration הוא *בקשה*, לא הבטחה. ב-Hobby
 * הוא נחתך בשקט ל-60, ותקציב שנגזר מ-300 היה גורם ללולאה להאמין שיש לה פי
 * חמישה זמן ממה שיש — כלומר בדיוק הכשל שהמנגנון הזה נועד למנוע: הפונקציה
 * נקטעת בכוח באמצע שליחה, בלי onShutdown ובלי הזדמנות לרשום מה יצא.
 *
 * ברירת המחדל בטוחה ל-Hobby. מי שעל Pro מרים אותה עד 280 דרך משתנה סביבה,
 * ומקבל פי שישה הודעות בריצה — בלי לגעת בקוד ובלי להסתכן בטעות לכיוון השני.
 */
const DEFAULT_BUDGET_SECONDS = 45;

function budgetMs(): number {
  const configured = Number(process.env.CRON_TIME_BUDGET_SECONDS);
  const seconds =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BUDGET_SECONDS;
  // חסם עליון מול maxDuration עצמו: ערך גבוה ממנו לא יכול להיות נכון בשום תוכנית.
  return Math.min(seconds, maxDuration - 15) * 1000;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  const total = budgetMs();

  // שני המנועים חולקים את אותו חלון ריצה ואת אותה תקרה יומית. החלוקה כאן היא
  // של *זמן* בלבד — התקרה נספרת מהמסד, ולכן היא נאכפת נכון בשניהם בלי תיאום.
  //
  // הכללים רצים ראשונים ומקבלים את רוב החלון: הם המנגנון הוותיק, ומסע שמפספס
  // יום ממשיך מעצמו בריצה הבאה בלי לאבד את מקומו — יתרון שלכללים אין.
  const summary = await runTimeSinceNoReplyRules(now, Math.floor(total * 0.6));
  const failed = summary.results.filter((r) => !r.ok);

  const journeys = await runJourneys(new Date(), Math.floor(total * 0.4));

  return NextResponse.json({
    ok: true,
    checked_at: new Date().toISOString(),
    sent: summary.results.length - failed.length,
    failed: failed.length,
    journeys: {
      enrolled: journeys.enrolled,
      sent: journeys.sent,
      completed: journeys.completed,
      dead_ended: journeys.deadEnded,
      stopped_replied: journeys.stoppedReplied,
      failed: journeys.failed.length,
      skipped: journeys.skipped,
      stopped: journeys.stopped,
      errors: journeys.failed,
    },
    // מה שלא נשלח בריצה הזו ייתפס בריצה הבאה — automation_rule_runs מבטיח
    // שמי שכן קיבל לא יקבל שוב.
    skipped: summary.skipped,
    stopped: summary.stopped,
    remaining_today: summary.remainingToday,
    errors: failed,
  });
}
