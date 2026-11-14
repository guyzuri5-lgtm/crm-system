import "server-only";

/**
 * שליפת הרילז והתובנות ישירות מה-Graph API של מטא, דרך האפליקציה של גיא
 * (whtsp-leads) — במקום Composio, שהחיבור שלו לאינסטגרם פג ב-11.2026.
 *
 * הטוקן: System User בלי תפוגה (INSTAGRAM_GRAPH_TOKEN), עם instagram_basic,
 * instagram_manage_insights, pages_show_list ו-pages_read_engagement, וחשבון
 * האינסטגרם משויך ל-System User כנכס. מזהה חשבון האינסטגרם נלקח מ-INSTAGRAM_USER_ID,
 * ואם הוא חסר — מהדף שמחובר אליו (instagram_business_account).
 *
 * הצורה שחוזרת זהה לזו של instagram.mjs (Composio), כדי ש-refresh.ts, mergePosts
 * ומסך הניתוח לא ירגישו בהחלפה.
 */

const GRAPH = "https://graph.facebook.com/v23.0";
const VIDEO = new Set(["REELS", "VIDEO"]);
const METRICS = ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"];

export class GraphError extends Error {
  detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.detail = detail;
  }
}

export function graphToken() {
  return (process.env.INSTAGRAM_GRAPH_TOKEN || "").trim();
}

async function get<T = Record<string, unknown>>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const e = body?.error || {};
    throw new GraphError(e.message || `Graph API ${res.status}`, { code: e.code, subcode: e.error_subcode, type: e.type });
  }
  return body as T;
}

/** מזהה חשבון האינסטגרם העסקי: מהמשתנה, ואם אין — מהדף הראשון שמחובר לאינסטגרם */
export async function igUserId(token = graphToken()) {
  const fixed = (process.env.INSTAGRAM_USER_ID || "").trim();
  if (fixed) return fixed;
  const pages = await get<{ data?: { id: string; instagram_business_account?: { id: string } }[] }>(
    "me/accounts", { fields: "id,name,instagram_business_account", limit: "50" }, token);
  const hit = (pages.data || []).find((p) => p.instagram_business_account?.id);
  if (!hit) throw new GraphError("לא נמצא חשבון אינסטגרם עסקי שמחובר לדף. בדקו שלטוקן יש instagram_basic ושחשבון האינסטגרם משויך ל-System User.");
  return hit.instagram_business_account!.id;
}

export interface Reel {
  id: string; timestamp: string | null; date: string | null; mediaType: string | null; caption: string;
  permalink: string | null; thumbUrl: string | null; durationS: number | null;
  [k: string]: unknown;
}

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** הרילז מהחלון, הכי חדשים קודם. עוצר כשהעמוד יוצא מהחלון. */
export async function listReels(opts: { windowDays: number; pageSize?: number; maxPages?: number; log?: (m: string) => void }) {
  const token = graphToken();
  const user = await igUserId(token);
  const cutoff = Date.now() - opts.windowDays * 864e5;
  const reels: Reel[] = [];
  let next: string | null = null;
  for (let page = 0; page < (opts.maxPages ?? 10); page++) {
    const body: { data?: Record<string, unknown>[]; paging?: { next?: string } } = next
      ? await get(next, {}, token)
      : await get(`${user}/media`, {
          fields: "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count",
          limit: String(opts.pageSize ?? 50),
        }, token);
    let oldest = Infinity;
    for (const m of body.data || []) {
      const t = m.timestamp ? new Date(String(m.timestamp)) : null;
      if (!t || Number.isNaN(t.getTime())) continue;
      oldest = Math.min(oldest, t.getTime());
      if (t.getTime() < cutoff) continue;
      const type = String(m.media_product_type || m.media_type || "").toUpperCase();
      if (!VIDEO.has(type) && String(m.media_type || "").toUpperCase() !== "VIDEO") continue;
      reels.push({
        id: String(m.id), timestamp: t.toISOString(), date: t.toISOString().slice(0, 10),
        mediaType: String(m.media_type || m.media_product_type || "") || null,
        caption: typeof m.caption === "string" ? m.caption : "",
        permalink: (m.permalink as string) || null,
        thumbUrl: (m.thumbnail_url as string) || (m.media_url as string) || null,
        durationS: null,
        likes: num(m.like_count), comments: num(m.comments_count),
      });
    }
    opts.log?.(`page ${page + 1}: ${(body.data || []).length} media, ${reels.length} reels in window so far`);
    next = body.paging?.next || null;
    if (!next || oldest < cutoff) break;
  }
  return reels;
}

/** תובנות לריל אחד. מדד שמטא דוחה לסוג הזה של מדיה יורד, והשאר נשלפים בכל זאת. */
async function insights(id: string, token: string) {
  let metrics = [...METRICS];
  const out: Record<string, number | null> = {};
  for (let attempt = 0; attempt < METRICS.length && metrics.length; attempt++) {
    try {
      const body = await get<{ data?: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] }>(
        `${id}/insights`, { metric: metrics.join(",") }, token);
      for (const row of body.data || []) out[row.name] = num(row.total_value?.value ?? row.values?.[0]?.value);
      return out;
    } catch (e) {
      const said = (e as Error).message || "";
      const bad = metrics.filter((m) => said.includes(m));
      if (!bad.length || bad.length === metrics.length) throw e;
      metrics = metrics.filter((m) => !bad.includes(m));
    }
  }
  return out;
}

export async function attachInsights(posts: Reel[], opts: { concurrency?: number; log?: (m: string) => void } = {}) {
  const token = graphToken();
  const queue = [...posts];
  let done = 0;
  const failures: string[] = [];
  async function worker() {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      try {
        const m = await insights(p.id, token);
        p.reach = m.reach ?? null;
        p.views = m.views ?? null;
        p.likes = m.likes ?? p.likes ?? null;
        p.comments = m.comments ?? p.comments ?? null;
        p.shares = m.shares ?? null;
        p.saved = m.saved ?? null;
        p.totalInteractions = m.total_interactions ?? null;
        // מטא מחזירה זמן צפייה ממוצע במילישניות
        p.watchTimeS = m.ig_reels_avg_watch_time == null ? null : Math.round((m.ig_reels_avg_watch_time / 1000) * 10) / 10;
      } catch (e) {
        failures.push(`${p.id}: ${(e as Error).message}`);
      }
      opts.log?.(`insights ${++done}/${posts.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, posts.length) }, worker));
  // כישלון של כל הרילז = בעיה בטוקן, לא בריל אחד
  if (posts.length && failures.length === posts.length) throw new GraphError(`שליפת התובנות נכשלה: ${failures[0]}`);
  return { posts, failures };
}
