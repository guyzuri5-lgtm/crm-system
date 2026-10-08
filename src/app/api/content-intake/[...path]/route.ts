import { NextRequest, NextResponse } from "next/server";
import { ZernioError } from "@/lib/content/zernio";
import { checkIntakeToken, createIntakeItem, intakeContext, intakeStatus, intakeUploaded, replaceMedia } from "@/lib/content/intake";

/**
 * הכניסה של הסקיל video-to-gantt (מהמחשב של גיא) אל גאנט התוכן.
 *
 * לא תחת /api/content: שם כל בקשה דורשת סשן של איש צוות, והסקיל מזדהה
 * בטוקן משלו (src/lib/content/intake.ts). מה שאפשר לעשות מכאן מוגבל ליצירת
 * פריט שממתין לאישור ולהעלאת הקובץ שלו — שום תזמון ב-Zernio.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = RouteContext<"/api/content-intake/[...path]">;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const body = async (req: NextRequest) => {
  try {
    return (await req.json()) || {};
  } catch {
    return {};
  }
};

async function handle(req: NextRequest, ctx: Ctx) {
  if (!(await checkIntakeToken(req.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  const path = (await ctx.params).path.join("/");
  const m = req.method;
  try {
    if (m === "GET" && path === "context") return json(await intakeContext());
    if (m === "GET" && path === "status") return json(await intakeStatus());
    if (m === "POST" && path === "items") return json(await createIntakeItem(await body(req)));
    let p = /^media\/([\w-]{1,40})\/done$/.exec(path);
    if (m === "POST" && p) return json({ media: await intakeUploaded(p[1], req.nextUrl.searchParams.get("replace") === "1") });
    p = /^items\/([\w-]{1,60})\/media$/.exec(path);
    if (m === "POST" && p) return json(await replaceMedia(p[1], await body(req)));
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof ZernioError) return json({ error: e.hebrew, status: e.status }, 502);
    return json({ error: (e as Error).message }, 500);
  }
}

export const GET = handle;
export const POST = handle;
