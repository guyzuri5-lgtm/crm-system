/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */
import { NextRequest, NextResponse, after } from "next/server";
import { requireTeamSession } from "@/lib/api-auth";
import { getMeta, getSettings, updateSettings, contentDb } from "@/lib/content/db";
import { WritesDisabled, ZernioError, zget } from "@/lib/content/zernio";
import { accountSummary, accountFor } from "@/lib/content/accounts";
import { loadBoard, saveBoard, Conflict, Refused } from "@/lib/content/board";
import { confirmAction } from "@/lib/content/actions";
import * as Pub from "@/lib/content/publishing";
import * as Bank from "@/lib/content/automations";
import { readIg, refreshIg } from "@/lib/content/ig/refresh";

/**
 * כל ה-API של גאנט התוכן, מאחורי התחברות ל-CRM.
 *
 * מסלול אחד עם נתב פנימי ולא עשרים קבצי route: כולם חולקים את אותן שתי
 * בדיקות, ובקובץ אחד אי אפשר לשכוח אחת מהן במסלול חדש.
 *  - סשן של איש צוות (requireTeamSession), כמו בשאר ה-API של הדשבורד;
 *  - כל בקשה שמשנה משהו חייבת את הכותרת X-Gantt. אתר זר יכול לגרום לדפדפן
 *    לשלוח POST עם העוגייה, אבל לא להוסיף כותרת בלי preflight שלא יאושר.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = RouteContext<"/api/content/[...path]">;
type Handler = (req: NextRequest, p: Record<string, string>) => Promise<Response>;

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const out = (r: { status: number; json: unknown }) => json(r.json, r.status);
const body = async (req: NextRequest) => {
  try {
    return (await req.json()) || {};
  } catch {
    return {};
  }
};

const routes: [string, string, Handler][] = [
  // ── הלוח ──
  ["GET", "state", async () => {
    const [state, settings] = await Promise.all([loadBoard(), getSettings()]);
    return json({ ...state, settings });
  }],
  ["PUT", "state", async (req) => {
    try {
      return json(await saveBoard(await body(req)));
    } catch (e) {
      if (e instanceof Conflict) return json({ error: "הלוח עודכן בחלון אחר", revision: e.revision }, 409);
      if (e instanceof Refused) return json({ error: e.message }, 422);
      throw e;
    }
  }],
  ["GET", "server-view", async () => {
    // רענון הסטטוסים רץ אחרי התשובה, כדי שהלוח לא יחכה לו
    after(() => Pub.syncActive(55_000).catch(() => {}));
    const [items, links, worker, alerts] = await Promise.all([Pub.serverView(), Bank.linksView(), getMeta("worker_last"), getMeta("alerts")]);
    for (const [id, l] of Object.entries(links)) (items[id] ||= {}).automation = l;
    const armed = Object.values(links).filter((l: any) => l.status === "armed").length;
    const w = worker as any;
    return json({ items, alerts: alerts || [], armedCount: armed,
      worker: w ? { lastRun: w.at, ok: w.ok, summary: w.summary, stale: Date.now() / 1000 - w.at > 180 } : { lastRun: null, stale: true } });
  }],
  // עותק של הלוח לפני ייבוא — הגאנט קורא לזה לפני שהוא ממזג או מחליף
  ["POST", "snapshot", async () => {
    const s = await loadBoard();
    const key = `snapshot:${new Date().toISOString()}`;
    await contentDb().from("content_meta").insert({ key, value: s });
    const { data } = await contentDb().from("content_meta").select("key").like("key", "snapshot:%").order("key", { ascending: false });
    const old = (data || []).slice(20).map((r: any) => r.key);
    if (old.length) await contentDb().from("content_meta").delete().in("key", old);
    return json({ ok: true, key });
  }],
  ["GET", "export", async () => {
    const s = await loadBoard();
    delete (s as any).revision;
    return new NextResponse(JSON.stringify(s, null, 2), { headers: {
      "content-type": "application/json", "content-disposition": "attachment; filename=content-gantt-export.json" } });
  }],

  // ── Zernio: חיבורים, הגדרות, יומן ──
  ["GET", "accounts", async (req) => json(await accountSummary(req.nextUrl.searchParams.get("force") === "1"))],
  ["GET", "settings", async () => json(await getSettings())],
  ["PATCH", "settings", async (req) => {
    const b = await body(req);
    const patch: Record<string, unknown> = {};
    if ("writesEnabled" in b) patch.writesEnabled = Boolean(b.writesEnabled);
    if (typeof b.armLeadMinutes === "number") patch.armLeadMinutes = Math.min(10, Math.max(2, b.armLeadMinutes));
    const s = await updateSettings(patch);
    if ("writesEnabled" in patch) await contentDb().from("content_audit_log").insert({ actor: "ui", action: `writesEnabled -> ${patch.writesEnabled}`, ok: true });
    return json(s);
  }],
  ["GET", "audit-log", async (req) => {
    const limit = Math.min(500, Number(req.nextUrl.searchParams.get("limit")) || 100);
    const { data } = await contentDb().from("content_audit_log").select("*").order("id", { ascending: false }).limit(limit);
    return json((data || []).map((r: any) => ({ ...r, at: Date.parse(r.at) / 1000 })));
  }],
  ["POST", "actions/:id/confirm", async (req, p) => out(await confirmAction(p.id, await body(req)))],

  // ── מדיה: ישר מהמחשב ל-Zernio ──
  ["POST", "media/presign", async (req) => {
    const b = await body(req);
    if (!b.itemId) return json({ error: "חסר פריט" }, 400);
    return json(await Pub.presignMedia(String(b.itemId), b));
  }],
  ["POST", "media/:id/done", async (_r, p) => json({ media: await Pub.markUploaded(p.id) })],
  ["DELETE", "media/:id", async (_r, p) => json({ media: await Pub.deleteMedia(p.id) })],
  ["POST", "items/:id/media/order", async (req, p) => json({ media: await Pub.orderMedia(p.id, (await body(req)).ids || []) })],

  // ── תזמון ──
  ["POST", "items/:id/validate", async (_r, p) => {
    const v = await Pub.validateItem(p.id);
    return v ? json(v) : json({ error: "הפריט לא נמצא" }, 404);
  }],
  ["POST", "items/:id/schedule/plan", async (req, p) => out(await Pub.planSchedule(p.id, (await body(req)).mode === "update" ? "update" : "create"))],
  ["POST", "items/:id/cancel/plan", async (_r, p) => out(await Pub.planSimple(p.id, "cancel"))],
  ["POST", "items/:id/retry/plan", async (_r, p) => out(await Pub.planSimple(p.id, "retry"))],
  ["POST", "items/:id/sync", async (_r, p) => {
    await Pub.syncOne(p.id);
    return json(((await Pub.serverView()) as any)[p.id] || {});
  }],
  ["POST", "items/:id/release-unknown", async (_r, p) => {
    await Pub.releaseUnknown(p.id);
    return json({ ok: true });
  }],
  ["GET", "tiktok/creator-info", async (req) => {
    const a = await accountFor("tiktok");
    if (!a) return json({ error: "טיקטוק לא מחובר ב-Zernio" }, 404);
    return json(await zget(`/accounts/${a.id}/tiktok/creator-info`, { mediaType: req.nextUrl.searchParams.get("mediaType") || "video" }));
  }],

  // ── בנק האוטומציות ──
  ["GET", "bank", async () => json(await Bank.listBank())],
  ["POST", "bank", async () => json(await Bank.createAutomation())],
  ["GET", "bank/candidates", async () => json(await Bank.candidates())],
  ["PUT", "bank/:id", async (req, p) => json(await Bank.saveAutomation(p.id, await body(req)))],
  ["POST", "bank/:id/validate", async (_r, p) => json(await Bank.validate(p.id))],
  ["POST", "bank/:id/link/plan", async (req, p) => out(await Bank.planLink(p.id, String((await body(req)).itemId || "")))],
  ["POST", "bank/:id/update/plan", async (_r, p) => out(await Bank.planUpdate(p.id))],
  ["POST", "bank/:id/pause/plan", async (_r, p) => out(await Bank.planState(p.id, "pause"))],
  ["POST", "bank/:id/resume/plan", async (_r, p) => out(await Bank.planState(p.id, "resume"))],
  ["POST", "bank/:id/delete/plan", async (_r, p) => out(await Bank.planState(p.id, "delete"))],
  ["POST", "bank/:id/stats", async (_r, p) => json(await Bank.refreshStats(p.id))],
  ["GET", "bank/:id/emails", async (req, p) => {
    const rows = await Bank.emailsOf(p.id);
    if (req.nextUrl.searchParams.get("format") !== "csv") return json(rows);
    const csv = "﻿email,collected_at\n" + rows.map((r) => `${r.email},${r.collected_at}`).join("\n");
    return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=emails.csv" } });
  }],
  ["POST", "links/:id/unlink/plan", async (_r, p) => out(await Bank.planUnlink(p.id))],
  ["GET", "health", async () => json(await Bank.lastHealth())],
  ["POST", "health", async () => json(await Bank.runHealthSafe())],

  // ── רילז ──
  ["GET", "ig", async () => json(await readIg())],
  ["POST", "ig-refresh", async (req) => out(await refreshIg(await body(req)))],
];

function match(pattern: string, parts: string[]): Record<string, string> | null {
  const pp = pattern.split("/");
  if (pp.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pp[i] !== parts[i]) return null;
  }
  return params;
}

async function handle(req: NextRequest, ctx: Ctx) {
  const session = await requireTeamSession();
  if (!session) return json({ error: "צריך להתחבר ל-CRM" }, 401);
  if (req.method !== "GET" && req.headers.get("x-gantt") !== "1") return json({ error: "forbidden" }, 403);
  const { path } = await ctx.params;
  for (const [method, pattern, fn] of routes) {
    if (method !== req.method) continue;
    const p = match(pattern, path);
    if (!p) continue;
    try {
      return await fn(req, p);
    } catch (e) {
      if (e instanceof WritesDisabled)
        return json({ error: "כתיבה ל-Zernio כבויה (מצב בדיקה). זה מה שהיה נשלח:", dryRun: { method: e.method, path: e.path, body: e.body } }, 423);
      if (e instanceof ZernioError) return json({ error: e.hebrew, status: e.status }, 502);
      return json({ error: (e as Error).message }, 500);
    }
  }
  return json({ error: "not found" }, 404);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
