import { NextRequest, NextResponse } from "next/server";
import { runWorker } from "@/lib/content/worker";

// GET /api/cron/content-worker — עובד הרקע של גאנט התוכן. pg_cron קורא לו כל
// דקה עם אותו CRON_SECRET של crm-cron (ר' 0046_content_worker_cron.sql).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ZERNIO_API_KEY && !process.env.LATE_API_KEY) {
    return NextResponse.json({ ok: false, error: "ZERNIO_API_KEY missing" }, { status: 200 });
  }
  const result = await runWorker({ dry: request.nextUrl.searchParams.get("dry") === "1", budgetMs: 50_000 });
  return NextResponse.json(result);
}
