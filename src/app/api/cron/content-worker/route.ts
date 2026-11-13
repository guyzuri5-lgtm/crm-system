import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/content/worker";
import { dailyIgRefresh } from "@/lib/content/ig/refresh";

// GET /api/cron/content-worker — עובד הרקע של גאנט התוכן. pg_cron קורא לו כשיש
// עבודה דחופה, ולפחות כל 15 דקות, עם אותו CRON_SECRET של crm-cron (0051).
export const dynamic = "force-dynamic";
// 300 ולא 60: אחרי העובד (שנשאר בתקציב של 50 שניות) רצה פעם ביום השליפה מאינסטגרם,
// שלוקחת יותר — תובנות לכל ריל מ-60 הימים האחרונים.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ZERNIO_API_KEY && !process.env.LATE_API_KEY) {
    return NextResponse.json({ ok: false, error: "ZERNIO_API_KEY missing" }, { status: 200 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const result = await runWorker({ dry, budgetMs: 50_000 });
  // אחרי שהעובד שחרר את המנעול שלו, כדי שהשליפה הארוכה לא תעכב את הריצה הבאה
  let ig: unknown = null;
  if (!dry) {
    try {
      const r = await dailyIgRefresh();
      ig = r ? { status: r.status, ...(r.json as Record<string, unknown>), log: undefined } : null;
    } catch (e) {
      ig = { error: (e as Error).message };
    }
  }
  return NextResponse.json({ ...result, ig });
}
