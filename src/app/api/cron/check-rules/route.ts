import { NextRequest, NextResponse } from "next/server";
import { runTimeSinceNoReplyRules } from "@/lib/automation-engine";
import { runJourneys } from "@/lib/journey-engine";
import { runNewsletters } from "@/lib/newsletter-engine";
import { runEventReminders } from "@/lib/event-engine";

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
 *
 * **הפרויקט על Hobby (אומת מול גיא, 5.9.2026) — 45 הוא הערך הנכון כאן, ואין
 * להעלות את CRON_TIME_BUDGET_SECONDS.** אם התוכנית תשודרג אי־פעם, זה המקום
 * היחיד שצריך לגעת בו.
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
  const startedAt = Date.now();

  /**
   * כמה מהחלון עוד נשאר, *עכשיו*.
   *
   * זה מה שהחליף חלוקה לאחוזים קבועים מהתקציב המקורי. הבעיה בקבועים לא הייתה
   * החלוקה אלא הבזבוז: מנוע בלי עבודה סיים בחצי שנייה, והנתח שהוקצה לו פשוט
   * התאדה. בפועל זה חנק דווקא את המנוע שהכי זקוק לזמן — הניוזלטר קיבל חמישית
   * מהחלון (תשע שניות מתוך 45), עצר כשנותרו שלוש, ולכן הספיק קומץ נמענים
   * בריצה בזמן שהתקרה שלו בקוד היא 60. רשימה של 600 איש הייתה נמרחת על יום.
   *
   * כשנמדד: ריצה שאין בה מה לשלוח כלל לוקחת 5 שניות של שאילתות תחזוקה בלבד.
   * אלה חמש שניות שנגרעות מהזמן האמיתי, ולכן צריך למדוד מה נשאר ולא להניח.
   *
   * Math.max(0) כי מנוע יכול לחרוג מעט מהנתח שלו (הוא עוצר לפני *שליחה*
   * נוספת, אבל עדיין סוגר חשבון אחריה). חריגה כזו מקטינה את מה שנשאר לבאים
   * במקום לדחוף את הריצה כולה מעבר לתקציב, ותקציב שלילי פירושו "אל תתחיל".
   */
  const remaining = () => Math.max(0, total - (Date.now() - startedAt));

  // ארבעת המנועים חולקים את אותו חלון ריצה. החלוקה כאן היא של *זמן* בלבד —
  // כל תקרה נספרת מהמסד, ולכן היא נאכפת נכון בכולם בלי תיאום ביניהם.
  //
  // הכללים רצים ראשונים: הם המנגנון הוותיק, ומסע או ניוזלטר שמפספסים ריצה
  // ממשיכים מעצמם בבאה בלי לאבד את מקומם — יתרון שלכללים אין.
  //
  // הניוזלטר מקבל את רוב מה שנשאר, כי הוא היחיד שהעבודה שלו נמדדת במאות
  // נמענים. תזכורות האירועים אחרונות ועם השארית, ולא כי הן פחות חשובות: הן
  // הזולות ביותר (בדרך כלל אפס אירועים בחלון), וכשיש להן עבודה החלון שלהן
  // רחב בשעות ולא בדקות.
  const summary = await runTimeSinceNoReplyRules(now, Math.floor(remaining() * 0.4));
  const failed = summary.results.filter((r) => !r.ok);

  const journeys = await runJourneys(new Date(), Math.floor(remaining() * 0.4));

  const newsletters = await runNewsletters(new Date(), Math.floor(remaining() * 0.75));

  const eventReminders = await runEventReminders(new Date(), remaining());

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
    newsletters: {
      sent: newsletters.sent,
      failed: newsletters.failed,
      completed: newsletters.completed,
      remaining: newsletters.remaining,
      stopped: newsletters.stopped,
      errors: newsletters.errors,
    },
    event_reminders: {
      sent: eventReminders.sent,
      failed: eventReminders.failed,
      stopped: eventReminders.stopped,
      errors: eventReminders.errors,
    },
    // מה שלא נשלח בריצה הזו ייתפס בריצה הבאה — automation_rule_runs מבטיח
    // שמי שכן קיבל לא יקבל שוב.
    skipped: summary.skipped,
    stopped: summary.stopped,
    remaining_today: summary.remainingToday,
    errors: failed,
  });
}
