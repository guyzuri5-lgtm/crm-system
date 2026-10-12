import { NextRequest, NextResponse } from "next/server";
import { ZernioError } from "@/lib/content/zernio";
import { checkIntakeToken, createIntakeItem, intakeContext, intakeStatus, intakeUploaded, replaceMedia } from "@/lib/content/intake";
import { coverUploaded, presignCover } from "@/lib/content/covers";
import { confirmVideo, DriveNotConfiguredError, listPieces, matchVideo, runPieces } from "@/lib/content/pieces";

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
    // פיסות תוכן (src/lib/content/pieces.ts): התאמת סרטון מצולם לפיסה מהפרומפטר
    if (m === "GET" && path === "pieces") return json(await listPieces());
    if (m === "POST" && path === "pieces/match") return json(await matchVideo(await body(req)));
    if (m === "POST" && path === "pieces/confirm") return json(await confirmVideo(await body(req)));
    if (m === "POST" && path === "pieces/sync") return json(await runPieces());
    let p = /^media\/([\w-]{1,40})\/done$/.exec(path);
    if (m === "POST" && p) return json({ media: await intakeUploaded(p[1], req.nextUrl.searchParams.get("replace") === "1") });
    p = /^items\/([\w-]{1,60})\/media$/.exec(path);
    if (m === "POST" && p) return json(await replaceMedia(p[1], await body(req)));
    // קאבר לסרטון שמחכה לאישור (src/lib/content/covers.ts)
    p = /^items\/([\w-]{1,60})\/cover$/.exec(path);
    if (m === "POST" && p) return json(await presignCover(p[1], await body(req)));
    p = /^items\/([\w-]{1,60})\/cover\/done$/.exec(path);
    if (m === "POST" && p) return json({ cover: await coverUploaded(p[1]) });
    return json({ error: "not found" }, 404);
  } catch (e) {
    if (e instanceof ZernioError) return json({ error: e.hebrew, status: e.status }, 502);
    if (e instanceof DriveNotConfiguredError) return json({ error: e.message }, 503);
    return json({ error: (e as Error).message }, 500);
  }
}

export const GET = handle;
export const POST = handle;
