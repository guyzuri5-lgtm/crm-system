import { NextRequest, NextResponse } from "next/server";
import { runTimeSinceNoReplyRules } from "@/lib/automation-engine";

// GET /api/cron/check-rules — per spec section 4, runs once a day (see vercel.json).
// Vercel Cron always calls with GET, and automatically sends
// `Authorization: Bearer $CRON_SECRET` when a CRON_SECRET env var is set on the
// project — set one and this route (and only Vercel's own scheduler) can call it.
export const dynamic = "force-dynamic";
// Vercel's Hobby plan hard-caps functions at 60s regardless of this setting; raise it
// if you're on Pro and end up with enough contacts/rules that a day's run needs longer.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const results = await runTimeSinceNoReplyRules();
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: true,
    checked_at: new Date().toISOString(),
    sent: results.length - failed.length,
    failed: failed.length,
    errors: failed,
  });
}
