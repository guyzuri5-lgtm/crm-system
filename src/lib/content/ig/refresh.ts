import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getMeta, must, nowIso, setMeta } from "../db";
import { tryLease } from "../db";
// מודול השליפה מאינסטגרם (Composio) הועבר כמו שהוא מ-content-gantt/api/_lib
import { IgError, getInstagramConnection, listReelsInWindow, attachInsights, mergePosts } from "./instagram.mjs";

/**
 * "ניתוח רילז חדשים" — אותה לוגיקה כמו api/ig-refresh.mjs בגאנט הישן, רק שהנתונים
 * נשמרים ב-content_ig_imports במסד של ה-CRM ולא ב-Supabase הישן.
 * הבדיקה "הבקשה הגיעה מהלוח" של הגרסה הישנה מיותרת כאן: המסלול דורש התחברות ל-CRM.
 */

const BOARD_ID = "main";
const COMPOSIO_USER_ID = process.env.COMPOSIO_USER_ID || "ig-report-user";
const MAX_WINDOW_DAYS = 365;
const MAX_FETCH_LIMIT = 50;

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export async function readIg(): Promise<{ generatedAt?: string; windowDays?: number; posts: any[] }> {
  const row = must(await contentDb().from("content_ig_imports").select("data").eq("id", BOARD_ID).maybeSingle(), "ig") as any;
  const d = row?.data;
  return d && Array.isArray(d.posts) ? d : { posts: [] };
}

async function writeIg(payload: unknown) {
  must(await contentDb().from("content_ig_imports").upsert({ id: BOARD_ID, data: payload, updated_at: nowIso() }), "ig write");
}

export async function refreshIg(body: Record<string, any>) {
  const apiKey = (process.env.COMPOSIO_API_KEY || "").trim();
  if (!apiKey) return { status: 500, json: { error: "COMPOSIO_API_KEY לא מוגדר בשרת.", hint: "Vercel → crm-system → Settings → Environment Variables → COMPOSIO_API_KEY, ואז deploy מחדש." } };
  // אחת לדקה — בלי זה לחיצה כפולה או לולאה תקועה שורפות את המכסה של Composio
  if (!(await tryLease("ig_refresh_lock", 60))) return { status: 429, json: { error: "שליפה רצה ממש עכשיו. נסו שוב בעוד דקה." } };

  const windowDays = clamp(body.windowDays, 30, 1, MAX_WINDOW_DAYS);
  const fetchLimit = clamp(body.fetchLimit, 25, 1, MAX_FETCH_LIMIT);
  const refreshDays = clamp(body.refreshDays, 14, 0, MAX_WINDOW_DAYS);
  const mode = body.mode === "full" ? "full" : "incremental";
  const log: string[] = [];
  const note = (m: string) => log.push(m);
  try {
    const connection = await getInstagramConnection(apiKey, COMPOSIO_USER_ID);
    if (!connection.connected) return { status: 409, json: { error: "אינסטגרם לא מחוברת ל-Composio.", hint: "חיבור ראשוני הוא אישור OAuth ידני (ig-report: npm run agent)." } };
    const stored = await readIg();
    const byId = new Map(stored.posts.map((p) => [p.id, p]));
    note(`שמורים כרגע: ${stored.posts.length} רילז`);
    const { reels } = await listReelsInWindow(apiKey, COMPOSIO_USER_ID, { windowDays, fetchLimit, log: note });
    note(`נמצאו ${reels.length} רילז בחלון של ${windowDays} ימים`);
    const cutoff = Date.now() - refreshDays * 864e5;
    const targets = mode === "full" ? reels : reels.filter((r: any) => {
      const prev = byId.get(r.id);
      if (!prev) return true;
      if (prev.reach == null && prev.views == null) return true;
      return new Date(r.timestamp).getTime() >= cutoff;
    });
    note(`נשלפות תובנות ל-${targets.length} רילז`);
    if (!targets.length) {
      await reposts(note);
      return { status: 200, json: { ok: true, added: 0, updated: 0, total: stored.posts.length, message: "אין רילז חדשים לנתח.", log } };
    }
    await attachInsights(apiKey, COMPOSIO_USER_ID, targets, { concurrency: 4 });
    const { posts, added, updated } = mergePosts(stored.posts, reels);
    for (const p of posts) if (typeof p.thumb === "string" && p.thumb.length > 40 * 1024) delete p.thumb;
    const payload = { generatedAt: new Date().toISOString(), windowDays: Math.max(windowDays, stored.windowDays || 0), posts };
    await writeIg(payload);
    // הביצועים נכנסים גם לשורה של כל פיסת תוכן (pieces.ts). import דינמי: pieces מייבא את readIg מכאן.
    try {
      const { syncMetrics } = await import("../pieces");
      const r = await syncMetrics();
      if (r.updated) note(`עודכנו ביצועים ל-${r.updated} פיסות תוכן`);
    } catch (e: any) {
      note(`עדכון הביצועים בפיסות התוכן נכשל: ${e?.message || e}`);
    }
    await reposts(note);
    return { status: 200, json: { ok: true, added, updated, total: posts.length, generatedAt: payload.generatedAt, log } };
  } catch (e: any) {
    const detail = e instanceof IgError ? (e as any).detail : null;
    return { status: 502, json: { error: e?.message || "השליפה נכשלה.", detail: detail ? JSON.stringify(detail).slice(0, 1200) : undefined, log } };
  }
}

/** העלאות חוזרות (reposts.ts) אחרי כל שליפה — רק אז הצפיות משתנות. כישלון שם לא מכשיל את השליפה. */
async function reposts(note: (m: string) => void) {
  try {
    const { runReposts } = await import("../reposts");
    const r = await runReposts();
    for (const c of r.created) note(`העלאה חוזרת: '${c.title}' (${c.views} צפיות) נכנס לגאנט ב-${c.date} ${c.time}`);
    for (const s of r.skipped) note(`העלאה חוזרת לא נוצרה ל-'${s.title}': ${s.reason}`);
  } catch (e: any) {
    note(`בדיקת ההעלאות החוזרות נכשלה: ${e?.message || e}`);
  }
}

const DAILY_OK_S = 20 * 3600;
const DAILY_RETRY_S = 2 * 3600;

/**
 * שליפה יומית של נתוני אינסטגרם, כדי שההעלאות החוזרות לא יחכו ללחיצה על "ניתוח רילז".
 * נקראת מהקרון של עובד הרקע אחרי שהוא סיים. 60 הימים האחרונים מתעדכנים: מספיק כדי
 * לתפוס סרטון שעובר 1000 (או העלאה חוזרת שעוברת 2000) גם שבועות אחרי שעלה.
 */
export async function dailyIgRefresh() {
  const last = await getMeta<{ at: number; ok: boolean }>("ig_daily_last");
  const age = Date.now() / 1000 - (last?.at || 0);
  if (last && age < (last.ok ? DAILY_OK_S : DAILY_RETRY_S)) return null;
  if (!(await tryLease("ig_daily", 280))) return null;
  const r = await refreshIg({ windowDays: 90, refreshDays: 60, fetchLimit: 50, mode: "incremental" });
  const j: any = r.json;
  await setMeta("ig_daily_last", { at: Date.now() / 1000, ok: r.status === 200, status: r.status, error: j.error || null, log: (j.log || []).slice(-12) });
  return r;
}
