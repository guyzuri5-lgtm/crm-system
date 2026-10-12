import "server-only";

import { contentDb, must } from "@/lib/content/db";

/**
 * עלות הבירולים לכל סרטון (0049_broll_costs.sql).
 *
 * הכתיבה מגיעה מהסקיל talking-head-to-ae דרך /api/content-intake/broll-costs,
 * והקריאה מהמסך /content/costs. השורה מזוהה בתיקיית הסרטון, ולכן שליחה
 * חוזרת (בסוף העריכה, ושוב כשהריצה האוטומטית נגמרת) מעדכנת ולא מכפילה.
 */

export type BrollCost = {
  video_folder: string;
  piece_no: number | null;
  title: string;
  ai_brolls: number;
  ai_videos: number;
  ai_images: number;
  ai_seconds: number;
  ai_usd: number;
  claude_usd: number | null;
  claude_tokens: number | null;
  edited_at: string;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export async function saveBrollCost(b: Record<string, unknown>) {
  const folder = typeof b.videoFolder === "string" ? b.videoFolder.trim() : "";
  if (!folder) throw new Error("videoFolder is required");
  const pieceNo = Number.isInteger(b.pieceNo) ? (b.pieceNo as number) : null;
  const title = (typeof b.title === "string" && b.title.trim()) || folder;
  const claude = typeof b.claudeUsd === "number" && Number.isFinite(b.claudeUsd) ? b.claudeUsd : null;
  const row = {
    video_folder: folder,
    piece_no: pieceNo,
    title,
    ai_brolls: Math.round(num(b.aiBrolls)),
    ai_videos: Math.round(num(b.aiVideos)),
    ai_images: Math.round(num(b.aiImages)),
    ai_seconds: num(b.aiSeconds),
    ai_usd: num(b.aiUsd),
    claude_usd: claude,
    claude_tokens: typeof b.claudeTokens === "number" ? Math.round(b.claudeTokens) : null,
    details: b.details && typeof b.details === "object" ? b.details : null,
    updated_at: new Date().toISOString(),
  };
  must(await contentDb().from("content_broll_costs").upsert(row, { onConflict: "video_folder" }), "broll cost");
  return { ok: true, videoFolder: folder };
}

export async function listBrollCosts(): Promise<BrollCost[]> {
  const rows = must(
    await contentDb().from("content_broll_costs").select("*").order("edited_at", { ascending: false }),
    "broll costs",
  ) as BrollCost[];
  // numeric מגיע מ-PostgREST כמחרוזת
  return rows.map((r) => ({
    ...r,
    ai_seconds: Number(r.ai_seconds) || 0,
    ai_usd: Number(r.ai_usd) || 0,
    claude_usd: r.claude_usd == null ? null : Number(r.claude_usd),
    claude_tokens: r.claude_tokens == null ? null : Number(r.claude_tokens),
  }));
}
