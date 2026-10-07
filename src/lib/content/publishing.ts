import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { randomUUID } from "node:crypto";
import { contentDb, getSettings, must, nowIso } from "./db";
import { zget, zvalidate, zwrite, audit, humanize, ZernioError } from "./zernio";
import { accountSummary } from "./accounts";
import { createAction, dryRunView, executor, fingerprint } from "./actions";
import {
  buildBody, isBlocked, mediaKind, PLATFORM_NAMES, POST_STATUS_HE, readPost, selected, validateLocal, opts, fmt,
  whenLocal, TIKTOK_PRIVACY, YT_VISIBILITY, FORMAT_NAMES, type Item, type MediaRow,
} from "./pure/platforms";

/**
 * תזמון לאינסטגרם, פייסבוק, טיקטוק ויוטיוב דרך Zernio.
 *
 * המדיה לא עוברת דרכנו: הדפדפן מבקש כאן כתובת העלאה (POST /media/presign),
 * מעלה את הקובץ ישירות מהמחשב לאחסון של Zernio, ומדווח כשסיים. נשמרת רק
 * הכתובת הציבורית, והיא מה שנכנס ל-mediaItems בפוסט.
 */

const ALLOWED: Record<string, string> = {
  ".mov": "video/quicktime", ".mp4": "video/mp4", ".m4v": "video/x-m4v", ".webm": "video/webm",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

// ── מדיה ──

export async function mediaRows(itemId: string): Promise<MediaRow[]> {
  return must(
    await contentDb().from("content_media").select("*").eq("item_id", itemId).is("deleted_at", null).order("sort").order("created_at"),
    "media",
  ) as MediaRow[];
}

export function mediaPublic(m: any) {
  const meta = m.meta || {};
  return {
    id: m.id, filename: m.filename, contentType: m.content_type, size: m.size, kind: mediaKind(m), url: m.public_url,
    status: m.status, uploadedAt: m.uploaded_at, duration: meta.duration ?? null, width: meta.width ?? null, height: meta.height ?? null,
  };
}

/**
 * כתובת העלאה חד-פעמית. זו קריאת יצירה ב-Zernio (קובץ זמני, לא פוסט ולא
 * גלוי לאיש), והבעלים בחר שהיא תקרה ברגע שבוחרים קובץ — ולכן היא לא תלויה
 * במתג הכתיבה, אבל נרשמת ביומן.
 */
export async function presignMedia(itemId: string, file: { filename: string; contentType?: string; size: number; meta?: any }) {
  const name = String(file.filename || "file").replace(/[^\w.\- ֐-׿]+/g, "_").slice(0, 120);
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
  const ct = ALLOWED[ext] || file.contentType || "";
  if (!Object.values(ALLOWED).includes(ct)) throw new Error(`סוג קובץ לא נתמך (${ct || ext}). אפשר וידאו MP4/MOV או תמונה JPG/PNG/WEBP.`);
  const size = Number(file.size);
  if (!(size > 0) || size > 5 * 1024 ** 3) throw new Error("גודל קובץ לא תקין (עד 5GB).");
  const data = await zwrite<any>("POST", "/media/presign", { filename: name, contentType: ct, size },
    { action: "media upload (temporary, on file select)", itemId, safety: true });
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const meta: Record<string, number> = {};
  for (const k of ["duration", "width", "height"]) {
    const v = Number(file.meta?.[k]);
    if (Number.isFinite(v) && v > 0) meta[k] = v;
  }
  const count = must(await contentDb().from("content_media").select("id", { count: "exact", head: true }).eq("item_id", itemId).is("deleted_at", null), "count") as any;
  must(await contentDb().from("content_media").insert({
    id, item_id: itemId, filename: name, public_url: data.publicUrl, zernio_key: data.key, content_type: ct, size,
    sort: Number(count?.count ?? 0), meta, status: "uploading",
  }), "media insert");
  // ה-uploadUrl חוזר לדפדפן ולא נשמר: הוא חתום לשעה, וכל אחד שמחזיק אותו יכול לכתוב לשם
  return { mediaId: id, uploadUrl: data.uploadUrl as string, contentType: ct };
}

/** הדפדפן סיים להעלות. בודקים שהקובץ באמת שם ובגודל הנכון. */
export async function markUploaded(mediaId: string) {
  const m = must(await contentDb().from("content_media").select("*").eq("id", mediaId).maybeSingle(), "media");
  if (!m) throw new Error("הקובץ לא נמצא");
  let ok = false;
  try {
    const r = await fetch(m.public_url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    ok = r.ok && Number(r.headers.get("content-length") || m.size) === Number(m.size);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("הקובץ לא נמצא באחסון של Zernio אחרי ההעלאה — נסו להעלות שוב.");
  must(await contentDb().from("content_media").update({ status: "ready", uploaded_at: nowIso() }).eq("id", mediaId), "media ready");
  return (await mediaRows(m.item_id)).map(mediaPublic);
}

export async function deleteMedia(mediaId: string) {
  const m = must(await contentDb().from("content_media").select("item_id").eq("id", mediaId).maybeSingle(), "media");
  if (!m) throw new Error("לא נמצא");
  must(await contentDb().from("content_media").update({ deleted_at: nowIso() }).eq("id", mediaId), "media delete");
  return (await mediaRows(m.item_id)).map(mediaPublic);
}

export async function orderMedia(itemId: string, ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    must(await contentDb().from("content_media").update({ sort: i }).eq("id", ids[i]).eq("item_id", itemId), "media order");
  }
  return (await mediaRows(itemId)).map(mediaPublic);
}

// ── מצב מהשרת לכל פריט (לרענון הלוח בלי טעינה) ──

export async function serverView() {
  const out: Record<string, any> = {};
  const pubs = must(await contentDb().from("content_publications").select("*"), "pubs");
  for (const r of pubs as any[]) {
    (out[r.item_id] ||= {}).pub = {
      zernioPostId: r.zernio_post_id, status: r.status, statusHe: POST_STATUS_HE[r.status] || r.status,
      scheduledFor: r.scheduled_for, timezone: r.timezone, lastSyncedAt: r.last_synced_at, error: r.last_error,
    };
  }
  const tg = must(await contentDb().from("content_targets").select("*"), "targets");
  for (const r of tg as any[]) {
    ((out[r.item_id] ||= {}).targets ||= {})[r.platform] = {
      status: r.status, statusHe: POST_STATUS_HE[r.status] || r.status, accountId: r.account_id,
      platformPostId: r.platform_post_id, permalink: r.permalink, error: r.error,
    };
  }
  const media = must(await contentDb().from("content_media").select("*").is("deleted_at", null).order("sort"), "media");
  for (const m of media as any[]) ((out[m.item_id] ||= {}).mediaFiles ||= []).push(mediaPublic(m));
  return out;
}

// ── סנכרון סטטוס מ-Zernio ──

async function getPub(itemId: string) {
  return must(await contentDb().from("content_publications").select("*").eq("item_id", itemId).maybeSingle(), "pub") as any;
}

export async function applyPost(itemId: string, post: any) {
  const r = readPost(post);
  const t = nowIso();
  for (const x of r.targets) {
    const prev = must(await contentDb().from("content_targets").select("platform_post_id, permalink").eq("item_id", itemId).eq("platform", x.platform).maybeSingle(), "target") as any;
    must(await contentDb().from("content_targets").upsert({
      item_id: itemId, platform: x.platform, account_id: x.accountId, status: x.status,
      platform_post_id: x.platformPostId || prev?.platform_post_id || null,
      permalink: x.permalink || prev?.permalink || null,        // קישור שכבר הגיע לא נמחק כשהבא ריק
      error: x.error, updated_at: t,
    }), "target upsert");
  }
  must(await contentDb().from("content_publications").update({
    status: r.status, last_synced_at: t, last_error: r.error, raw: post, updated_at: t,
  }).eq("item_id", itemId), "pub update");
}

export async function syncOne(itemId: string) {
  const pub = await getPub(itemId);
  if (!pub?.zernio_post_id) return null;
  try {
    const data = await zget<any>(`/posts/${pub.zernio_post_id}`, undefined, "get post");
    const post = data.post || data;
    await applyPost(itemId, post);
    return post;
  } catch (e) {
    const z = e instanceof ZernioError ? e : new ZernioError(0, { error: String(e) }, "get post");
    const patch = z.status === 404
      ? { status: "cancelled", last_error: "הפוסט לא נמצא ב-Zernio — כנראה נמחק שם ישירות.", last_synced_at: nowIso() }
      : { last_error: z.hebrew, last_synced_at: nowIso() };
    await contentDb().from("content_publications").update(patch).eq("item_id", itemId);
    return null;
  }
}

/** מרענן כל פוסט שעוד יכול להשתנות. רץ בעובד ובכניסה ללוח. */
export async function syncActive(maxAgeMs = 50_000) {
  const rows = must(await contentDb().from("content_publications").select("item_id, last_synced_at, status")
    .not("zernio_post_id", "is", null).in("status", ["scheduled", "publishing", "partial", "failed"]), "active pubs") as any[];
  let n = 0;
  for (const r of rows) {
    const age = Date.now() - (r.last_synced_at ? Date.parse(r.last_synced_at) : 0);
    if (age < maxAgeMs || (r.status === "failed" && age < 3600_000)) continue;
    await syncOne(r.item_id);
    n++;
  }
  return n;
}

// ── תכנון ──

async function loadItem(itemId: string): Promise<Item | null> {
  const r = must(await contentDb().from("content_items").select("data").eq("id", itemId).is("deleted_at", null).maybeSingle(), "item") as any;
  return r ? (r.data as Item) : null;
}

export async function validateItem(itemId: string) {
  const item = await loadItem(itemId);
  if (!item) return null;
  const { timezone } = await getSettings();
  return validateLocal(item, await mediaRows(itemId), await accountSummary(), timezone);
}

function summary(item: Item, media: MediaRow[], acct: any, body: any, tz: string) {
  const f = fmt(item);
  const networks = (body.platforms as any[]).map((e) => {
    const p = e.platform;
    const a = acct.platforms[p].account;
    const o = opts(item, p);
    let details: string[] = [];
    if (p === "youtube") {
      details = [`כותרת: ${o.title}`, `פרטיות: ${YT_VISIBILITY[o.visibility] || o.visibility}`, "יעלה כ: Short", `מיועד לילדים: ${o.madeForKids ? "כן" : "לא"}`];
      if (o.tags) details.push(`תגיות: ${o.tags}`);
    } else if (p === "tiktok") {
      details = [`פרטיות: ${TIKTOK_PRIVACY[o.privacyLevel] || o.privacyLevel}`, `תגובות: ${o.allowComment === false ? "לא" : "כן"}`];
      if (media.some((m) => mediaKind(m) === "video")) details.push(`דואט: ${o.allowDuet ? "כן" : "לא"}`, `סטיץ': ${o.allowStitch ? "כן" : "לא"}`);
      if (o.draft) details.push("נשלח לתיבת הטיוטות בטיקטוק — לא מתפרסם אוטומטית");
    } else if (p === "instagram") {
      const kind = f === "story" ? "סטורי" : media.length > 1 ? "קרוסלה" : media[0] && mediaKind(media[0]) === "video" ? "ריל" : "פוסט תמונה";
      details = [`יעלה כ: ${kind}`];
      if (o.firstComment && f !== "story") details.push(`תגובה ראשונה: ${o.firstComment}`);
    } else if (p === "facebook") {
      details = [`יעלה כ: ${f === "reel" || f === "story" ? FORMAT_NAMES[f] : "פוסט"}`];
    }
    return {
      platform: p, name: PLATFORM_NAMES[p], username: a?.username, displayName: a?.displayName,
      caption: e.customContent ?? body.content ?? "", customCaption: "customContent" in e, details,
    };
  });
  return {
    when: whenLocal(item), timezone: tz, title: item.title,
    media: media.map(mediaPublic), networks, tiktok: networks.some((n) => n.platform === "tiktok"),
  };
}

export async function planSchedule(itemId: string, mode: "create" | "update") {
  const item = await loadItem(itemId);
  if (!item) return { status: 404, json: { error: "הפריט לא נמצא" } };
  const media = await mediaRows(itemId);
  const pub = await getPub(itemId);
  const { timezone } = await getSettings();
  if (mode === "create" && pub?.zernio_post_id && pub.status !== "cancelled")
    return { status: 409, json: { error: "לפריט הזה כבר יש פוסט ב-Zernio. השתמשו בעדכון או בביטול." } };
  if (mode === "create" && pub?.status === "unknown")
    return { status: 409, json: { error: "בתזמון הקודם Zernio לא החזיר מזהה פוסט. בדקו באתר של Zernio שאין כבר פוסט כזה, ואז לחצו 'שחרור' בסטטוס." } };
  if (mode === "update") {
    if (!pub?.zernio_post_id) return { status: 409, json: { error: "אין פוסט קיים לעדכן." } };
    if (["published", "publishing"].includes(pub.status)) return { status: 409, json: { error: "הפוסט כבר עלה (או עולה עכשיו) — אי אפשר לערוך אותו דרך Zernio." } };
  }
  const acct = await accountSummary(true);
  const val = validateLocal(item, media, acct, timezone);
  if (isBlocked(val, item)) return { status: 200, json: { validation: val, blocked: true } };

  const body = buildBody(item, media, acct, timezone);
  // הבדיקה של Zernio עצמו: לא שומרת כלום ולא נוגעת בחשבונות או במדיה
  const probe: any = JSON.parse(JSON.stringify(body));
  delete probe.scheduledFor; delete probe.timezone; delete probe.metadata;
  const { status, data } = await zvalidate(probe);
  const remote = status === 0 || status >= 300
    ? { ok: false, unavailable: true, error: humanize(status, data), errors: [], warnings: [] }
    : { ok: Boolean(data.valid), errors: data.errors || [], warnings: data.warnings || [] };
  for (const er of remote.errors) (val[er.platform] ||= { errors: [], warnings: [] }).errors.push(`Zernio: ${er.error || ""}`);
  for (const wr of remote.warnings) (val[wr.platform] ||= { errors: [], warnings: [] }).warnings.push(`Zernio: ${wr.warning || ""}`);
  if (remote.errors.length) return { status: 200, json: { validation: val, remote, blocked: true } };

  const steps = mode === "create"
    ? [{ method: "POST", path: "/posts", body, idempotencyKey: `gantt-${itemId}-${randomUUID().slice(0, 12)}` }]
    : [{ method: "PUT", path: `/posts/${pub.zernio_post_id}`, body }];
  const plan = {
    itemId, mode, steps, mediaIds: media.map((m) => m.id),
    itemHash: fingerprint(item, media.map((m) => m.id)),
    summary: summary(item, media, acct, body, timezone),
  };
  const actionId = await createAction("schedule", itemId, plan);
  return { status: 200, json: { validation: val, remote, actionId, summary: plan.summary, requests: dryRunView(plan) } };
}

executor("schedule", async (plan, body) => {
  const itemId = plan.itemId as string;
  if (plan.summary?.tiktok && !body.tiktokConsent) throw new Error("לטיקטוק צריך לסמן את אישור התוכן במסך האישור");
  const item = await loadItem(itemId);
  const media = await mediaRows(itemId);
  if (!item || fingerprint(item, media.map((m) => m.id)) !== plan.itemHash)
    throw new Error("הפריט השתנה אחרי שמסך האישור נפתח — פתחו אותו מחדש");
  const step = plan.steps[0];
  const data = await zwrite<any>(step.method, step.path, step.body, {
    action: step.method === "POST" ? "create post" : "update post", itemId,
    // Idempotency-Key: ניסיון חוזר של אותו אישור לא יכול ליצור שני פוסטים
    headers: step.idempotencyKey ? { "Idempotency-Key": step.idempotencyKey } : undefined,
  });
  let post = data.post || {};
  if (!post._id && data.postId) post = { _id: data.postId, status: "scheduled" };   // 202: עוד נשמר
  const prev = await getPub(itemId);
  const postId = post._id || prev?.zernio_post_id || null;
  const t = nowIso();
  must(await contentDb().from("content_publications").upsert({
    item_id: itemId, zernio_post_id: postId, status: post.status || (postId ? "scheduled" : "unknown"),
    scheduled_for: String(step.body.scheduledFor).slice(0, 16), timezone: step.body.timezone,
    sent_payload: { ...step.body, _mediaIds: plan.mediaIds }, last_error: null, updated_at: t,
  }), "pub upsert");
  const keep = (step.body.platforms as any[]).map((e) => e.platform);
  const old = must(await contentDb().from("content_targets").select("platform").eq("item_id", itemId), "targets") as any[];
  const drop = old.map((r) => r.platform).filter((p) => !keep.includes(p));
  if (drop.length) must(await contentDb().from("content_targets").delete().eq("item_id", itemId).in("platform", drop), "targets drop");
  for (const e of step.body.platforms as any[]) {
    must(await contentDb().from("content_targets").upsert({
      item_id: itemId, platform: e.platform, account_id: e.accountId, caption_override: e.customContent ?? null,
      options: e.platformSpecificData || {}, status: "scheduled", error: null, updated_at: t,
    }), "target upsert");
  }
  // Zernio מעתיק את המדיה לאחסון קבוע ברגע שפוסט מפנה אליה
  if (plan.mediaIds.length) must(await contentDb().from("content_media").update({ used_in_post_at: t }).in("id", plan.mediaIds), "media used");
  if (data.post) await applyPost(itemId, data.post);
  return { zernioPostId: postId, status: post.status, warnings: data.warnings || [],
    message: step.method === "POST" ? "הפוסט תוזמן ב-Zernio" : "הפוסט עודכן ב-Zernio" };
});

export async function planSimple(itemId: string, kind: "cancel" | "retry") {
  const pub = await getPub(itemId);
  const tg = must(await contentDb().from("content_targets").select("platform, status").eq("item_id", itemId), "targets") as any[];
  if (!pub?.zernio_post_id) return { status: 409, json: { error: "אין פוסט ב-Zernio לפריט הזה" } };
  let step, text, networks;
  if (kind === "cancel") {
    if (pub.status === "published") return { status: 409, json: { error: "פוסט שכבר עלה אי אפשר לבטל דרך Zernio (באינסטגרם ובטיקטוק אין הסרה דרך ה-API)." } };
    step = { method: "DELETE", path: `/posts/${pub.zernio_post_id}` };
    text = "מחיקת הפוסט המתוזמן מ-Zernio. הוא לא יעלה לאף רשת. הפריט עצמו נשאר בלוח.";
    networks = tg.map((t) => PLATFORM_NAMES[t.platform] || t.platform);
  } else {
    if (!["failed", "partial"].includes(pub.status)) return { status: 409, json: { error: "אפשר לנסות שוב רק פוסט שנכשל או שעלה חלקית" } };
    step = { method: "POST", path: `/posts/${pub.zernio_post_id}/retry` };
    text = "ניסיון חוזר — רק ברשתות שנכשלו. רשת שכבר עלתה לא תפורסם פעמיים (Zernio לא מאפשר לבחור רשת אחת; הוא מנסה שוב את כל אלה שנכשלו).";
    networks = tg.filter((t) => t.status === "failed").map((t) => PLATFORM_NAMES[t.platform] || t.platform);
  }
  const plan = { itemId, kind, steps: [step], summary: { text, networks } };
  const actionId = await createAction(kind, itemId, plan);
  return { status: 200, json: { actionId, summary: plan.summary, requests: dryRunView(plan) } };
}

executor("cancel", async (plan) => {
  await zwrite("DELETE", plan.steps[0].path, undefined, { action: "cancel post", itemId: plan.itemId });
  const t = nowIso();
  await contentDb().from("content_publications").update({ status: "cancelled", last_synced_at: t, updated_at: t }).eq("item_id", plan.itemId);
  await contentDb().from("content_targets").update({ status: "cancelled", updated_at: t }).eq("item_id", plan.itemId);
  return { message: "הפוסט בוטל ב-Zernio" };
});

executor("retry", async (plan) => {
  const data = await zwrite<any>("POST", plan.steps[0].path, undefined, { action: "retry post", itemId: plan.itemId });
  if (data.post) await applyPost(plan.itemId, data.post);
  return { message: "נשלח ניסיון חוזר", status: data.post?.status };
});

export async function releaseUnknown(itemId: string) {
  await contentDb().from("content_publications").update({ status: "cancelled", last_error: null }).eq("item_id", itemId).eq("status", "unknown");
  await audit({ actor: "ui", action: "released 'unknown' post state after manual check", item_id: itemId, ok: true });
}

export { selected };
