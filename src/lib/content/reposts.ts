import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- שורות content_* ותשובות Zernio לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { randomUUID } from "node:crypto";
import { contentDb, getSettings, must, nowIso, setMeta } from "./db";
import { bumpRevision } from "./intake";
import { readIg } from "./ig/refresh";
import { localNow } from "./pure/autoplan";
import { normPermalink } from "./pure/pieces";
import { qualifies, repostData, repostSlot } from "./pure/reposts";

/**
 * העלאה חוזרת של סרטון שהצליח (הכללים ב-pure/reposts.ts). רץ אחרי כל שליפה של
 * נתוני אינסטגרם — היומית מהקרון, וגם הכפתור "ניתוח רילז" — כי רק אז הצפיות משתנות.
 *
 * הפריט החדש נכנס לגאנט ביום ובשעה המדויקים, עם intake, ולכן השיבוץ האוטומטי
 * (autoplan.ts) מתזמן אותו ב-Zernio כמו סרטון שגיא גרר ליום: הוא לא זז משם, ועובר
 * את כל הבדיקות של "אשר ותזמן" — כולל האוטומציה לתגובות, שעוברת מהמקור.
 *
 * הקובץ לא עולה שוב מהמחשב: Zernio מעתיק כל העלאה שפוסט מפנה אליה לאחסון קבוע
 * (media.zernio.com/media/...), והכתובת הזאת שמורה ב-content_publications.raw של
 * הפוסט המקורי. היא נכנסת כשורת מדיה עם used_in_post_at, כדי שאף בדיקה של "הקובץ
 * הזמני עומד לפוג" לא תחול עליה.
 */

const DONE = ["published", "partial"];

export interface RepostReport {
  at: number;
  created: { id: string; from: string; title: string; date: string; time: string; views: number }[];
  skipped: { from: string; title: string; reason: string }[];
}

function viewsLookup(posts: any[]) {
  const byId = new Map<string, any>();
  const byLink = new Map<string, any>();
  for (const p of posts) {
    if (p?.id) byId.set(String(p.id), p);
    const k = normPermalink(p?.permalink);
    if (k) byLink.set(k, p);
  }
  return (t: { platform_post_id?: string | null; permalink?: string | null }) =>
    (t.platform_post_id && byId.get(String(t.platform_post_id))) || byLink.get(normPermalink(t.permalink) || "") || null;
}

const lastSegment = (url: string) => String(url || "").split("?")[0].split("/").pop() || "";

async function reachable(url: string) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    return r.ok ? Number(r.headers.get("content-length")) || null : false;
  } catch {
    return false;
  }
}

async function allItems() {
  const out: { id: string; data: any; deleted_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await contentDb().from("content_items").select("id, data, deleted_at").order("id").range(from, from + 999), "items") as any[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function runReposts(log: (m: string) => void = () => {}, opts: { dry?: boolean } = {}): Promise<RepostReport> {
  const report: RepostReport = { at: Date.now() / 1000, created: [], skipped: [] };
  const { posts } = await readIg();
  if (!posts.length) return report;
  const viewsOf = viewsLookup(posts);
  const { timezone } = await getSettings();
  const now = localNow(timezone);

  const items = await allItems();
  // כל העלאה מולידה לכל היותר העלאה חוזרת אחת. גם פריט שנמחק נספר: אם גיא מחק
  // העלאה חוזרת מהגאנט, היא לא נוצרת שוב.
  const hasChild = new Set(items.map((r) => r.data?.repost?.from).filter(Boolean));
  const live = items.filter((r) => !r.deleted_at && r.data?.format !== "story" && !hasChild.has(r.id));
  if (!live.length) return report;

  const pubs = new Map((must(await contentDb().from("content_publications").select("item_id, status, scheduled_for, raw")
    .in("status", DONE), "pubs") as any[]).map((p) => [p.item_id, p]));
  const igTargets = new Map((must(await contentDb().from("content_targets").select("item_id, platform_post_id, permalink, status")
    .eq("platform", "instagram").in("status", DONE), "ig targets") as any[]).map((t) => [t.item_id, t]));

  for (const r of live) {
    const pub = pubs.get(r.id);
    const target = igTargets.get(r.id);
    if (!pub || !target) continue;
    const post = viewsOf(target);
    const generation = Number(r.data.repost?.generation) || 0;
    if (!post || !qualifies(post.views, generation)) continue;

    const title = String(r.data.title || "");
    const skip = (reason: string) => { report.skipped.push({ from: r.id, title, reason }); log(`repost skip ${r.id.slice(0, 8)}: ${reason}`); };

    const published = String(pub.scheduled_for || (r.data.date ? `${r.data.date}T${r.data.time || "18:00"}` : ""));
    const slot = repostSlot(published, now);
    if (!slot) { skip("אין תאריך העלאה למקור"); continue; }

    // המדיה הקבועה מהפוסט המקורי ב-Zernio
    const remote: any[] = (pub.raw?.mediaItems || pub.raw?.post?.mediaItems || []).filter((m: any) => m?.url);
    if (!remote.length || remote.some((m) => !/\/media\//.test(m.url))) { skip("אין כתובת קבועה לקובץ ב-Zernio"); continue; }
    const localRows = must(await contentDb().from("content_media").select("*").eq("item_id", r.id).is("deleted_at", null)
      .order("sort").order("created_at"), "media") as any[];

    const media: any[] = [];
    for (let i = 0; i < remote.length; i++) {
      const m = remote[i];
      const local = localRows.find((x) => lastSegment(x.public_url) === lastSegment(m.url)) || localRows[i] || null;
      const size = await reachable(m.url);
      if (size === false) break;
      media.push({ url: m.url, type: m.type, local, size });
    }
    if (media.length !== remote.length) { skip("הקובץ הקבוע ב-Zernio לא נגיש"); continue; }

    const link = must(await contentDb().from("content_automation_links").select("automation_id").eq("item_id", r.id)
      .order("created_at", { ascending: false }).limit(1), "links") as any[];
    const automationChoice = link[0]?.automation_id || r.data.automationChoice || null;

    const id = randomUUID();
    const at = nowIso();
    const file = media[0].local?.filename || lastSegment(media[0].url);
    const data = repostData(r.data, {
      id, date: slot.date, time: slot.time, at, file, views: Number(post.views), generation: generation + 1,
      rootId: r.data.repost?.root || r.id, fromId: r.id, publishedAt: published,
      cover: remote[0].instagramThumbnail || remote[0].thumbnail || null, automationChoice,
    });

    // בדיקה אחרונה לפני הכתיבה: ריצה מקבילה (הכפתור והקרון) לא יוצרת שתיים
    const twin = must(await contentDb().from("content_items").select("id").eq("data->repost->>from", r.id).limit(1), "repost twin") as any[];
    if (twin.length) continue;

    if (opts.dry) {
      report.created.push({ id, from: r.id, title, date: slot.date, time: slot.time, views: Number(post.views) });
      continue;
    }

    // קודם הגרסה עולה, ורק אז הפריט נכנס (כמו ב-intake.ts): חלון גאנט פתוח ייטען מחדש ולא ימחק אותו
    await bumpRevision();
    must(await contentDb().from("content_items").insert({ id, data, date: slot.date, updated_at: at }), "repost insert");
    must(await contentDb().from("content_media").insert(media.map((m, i) => ({
      id: randomUUID().replace(/-/g, "").slice(0, 16), item_id: id,
      filename: m.local?.filename || lastSegment(m.url), public_url: m.url, zernio_key: null,
      content_type: m.local?.content_type || (m.type === "video" ? "video/mp4" : "image/jpeg"),
      size: m.size || m.local?.size || null, sort: i, meta: m.local?.meta || {},
      status: "ready", uploaded_at: at, used_in_post_at: at,
    }))), "repost media");

    report.created.push({ id, from: r.id, title, date: slot.date, time: slot.time, views: Number(post.views) });
    log(`repost: '${title}' (${post.views} views) → ${slot.date} ${slot.time}`);
  }

  if (!opts.dry && (report.created.length || report.skipped.length)) await setMeta("reposts_last", report);
  return report;
}
