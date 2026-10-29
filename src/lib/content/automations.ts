import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getMeta, getSettings, must, nowIso, setMeta } from "./db";
import { apiKey, zget, zwrite, ZernioError } from "./zernio";
import { accountFor, type PublicAccount } from "./accounts";
import { createAction, dryRunView, executor, fingerprint } from "./actions";
import {
  commentAutomationBody, commentAutomationPatch, contentHash, CONTENT_FIELDS, emailFromVars, executionStats,
  injectKey, keywordsOf, norm, preview, validateAutomation, withFbWorkflow, workflowBody, workflowIdOf,
  META_NAMES, META_PLATFORMS, type Account, type Automation, type MetaPlatform, type OtherActive,
} from "./pure/automation";
import { saveEmailContact } from "./contacts";
import { zonedToUtc } from "./pure/platforms";

/**
 * בנק האוטומציות. אוטומציה אחת, הרבה פוסטים:
 *  - workflow אחד ב-Zernio לכל אוטומציה (הלחיצה על הכפתור → מייל → לינק).
 *    הוא מופעל לפי טקסט הכפתור, ולכן משותף לכל הפוסטים המקושרים;
 *  - אוטומציית תגובה אחת ב-Zernio לכל קישור לפוסט, צמודה לפוסט (platformPostId).
 * פוסט שעלה: נוצרת מיד. פוסט מתוזמן: "ממתינה", והעובד יוצר אותה סביב שעת
 * הפרסום ומצמיד (worker.ts).
 *
 * כל זה פעם לכל רשת: קישור הוא (פוסט, רשת), ופוסט שעולה גם לאינסטגרם וגם
 * לפייסבוק מקבל שני קישורים מאותה אוטומציה, ו-workflow נפרד לכל חשבון
 * (zernio_workflow_id לאינסטגרם, fb_workflow_id לדף).
 */

export const LINK_STATUS_HE: Record<string, string> = {
  armed: "ממתינה לפרסום", live: "פעילה", paused: "מושהית", error: "שגיאה", unlinked: "נותקה",
};

// ── קריאה ──

export async function getAutomation(id: string): Promise<Automation & Record<string, any>> {
  const a = must(await contentDb().from("content_automations").select("*").eq("id", id).maybeSingle(), "automation");
  if (!a) throw new Error("האוטומציה לא נמצאה");
  return a;
}

async function activeLinks(automationId: string) {
  return must(await contentDb().from("content_automation_links").select("*").eq("automation_id", automationId).is("unlinked_at", null).order("created_at"), "links") as any[];
}

function linkPlatform(l: any): MetaPlatform {
  return l?.platform === "facebook" ? "facebook" : "instagram";
}

/** החשבונות של Meta שמחוברים ב-Zernio, לפי רשת */
async function metaAccounts() {
  const out: Partial<Record<MetaPlatform, PublicAccount>> = {};
  for (const p of META_PLATFORMS) {
    const acct = await accountFor(p);
    if (acct) out[p] = acct;
  }
  return out;
}

/** כל אוטומציות התגובה החיות ב-Zernio, משני החשבונות (בדרך כלל אותו פרופיל) */
async function liveCommentAutomations(): Promise<any[]> {
  const profiles = new Set(Object.values(await metaAccounts()).map((a) => a!.profileId).filter(Boolean));
  const byId = new Map<string, any>();
  for (const profileId of profiles)
    for (const z of (await zget<any>("/comment-automations", { profileId })).automations || []) byId.set(z.id, z);
  return [...byId.values()];
}

async function targetOf(itemId: string, platform: MetaPlatform) {
  return must(await contentDb().from("content_targets").select("platform_post_id, status").eq("item_id", itemId).eq("platform", platform).maybeSingle(), "target") as any;
}

function workflowIds(a: any): [MetaPlatform, string][] {
  return META_PLATFORMS.map((p) => [p, workflowIdOf(a, p)] as [MetaPlatform, string | null]).filter((x): x is [MetaPlatform, string] => Boolean(x[1]));
}

async function itemsById(ids: string[]) {
  if (!ids.length) return {} as Record<string, any>;
  const rows = must(await contentDb().from("content_items").select("id, data").in("id", ids), "items") as any[];
  return Object.fromEntries(rows.map((r) => [r.id, r.data]));
}

export async function listBank() {
  const autos = must(await contentDb().from("content_automations").select("*").is("archived_at", null).order("created_at"), "automations") as any[];
  const links = must(await contentDb().from("content_automation_links").select("*").is("unlinked_at", null), "links") as any[];
  const items = await itemsById(links.map((l) => l.item_id));
  return autos.map((a) => {
    const mine = links.filter((l) => l.automation_id === a.id);
    return {
      ...a,
      dirty: Boolean(a.deployed_hash) && a.deployed_hash !== contentHash(a),
      links: mine.map((l) => linkPublic(l, items[l.item_id])),
    };
  });
}

function linkPublic(l: any, item: any) {
  return {
    id: l.id, itemId: l.item_id, platform: linkPlatform(l), platformHe: META_NAMES[linkPlatform(l)], status: l.status, statusHe: LINK_STATUS_HE[l.status] || l.status, scope: l.scope,
    lastError: l.last_error, stats: l.stats, statsAt: l.stats_at,
    item: item ? { title: item.title, date: item.date, time: item.time || null, source: item.source || null } : null,
  };
}

/** לצ'יפ בלוח: איזו אוטומציה מקושרת לכל פריט */
export async function linksView() {
  const links = must(await contentDb().from("content_automation_links").select("*, content_automations(name, status)").is("unlinked_at", null), "links") as any[];
  const { timezone } = await getSettings();
  const pubs = must(await contentDb().from("content_publications").select("item_id, scheduled_for"), "pubs") as any[];
  const due = Object.fromEntries(pubs.map((p) => [p.item_id, p.scheduled_for]));
  // לאילו רשתות של Meta כל פוסט עולה — כדי להציע "גם בפייסבוק" כשחסר
  const ids = [...new Set(links.map((l) => l.item_id))];
  const targets = ids.length
    ? must(await contentDb().from("content_targets").select("item_id, platform").in("item_id", ids).in("platform", META_PLATFORMS), "targets") as any[]
    : [];
  // פוסט עם שני קישורים מוצג כצ'יפ אחד: המצב הכי דחוף מביניהם
  const RANK: Record<string, number> = { error: 0, paused: 1, creating: 2, armed: 3, live: 4 };
  const out: Record<string, any> = {};
  for (const l of links) {
    let overdue = false;
    if (l.status === "armed" && due[l.item_id]) {
      const t = zonedToUtc(due[l.item_id], timezone);
      overdue = Boolean(t && Date.now() > t.getTime() + 2 * 60_000);
    }
    const prev = out[l.item_id];
    const platforms = [...(prev?.platforms || []), linkPlatform(l)];
    const worse = !prev || (RANK[l.status] ?? 5) < (RANK[prev.status] ?? 5);
    out[l.item_id] = {
      ...(worse ? {
        automationId: l.automation_id, name: l.content_automations?.name, status: l.status,
        statusHe: LINK_STATUS_HE[l.status] || l.status, stats: l.stats,
      } : prev),
      overdue: Boolean(prev?.overdue) || overdue, platforms,
    };
  }
  for (const [id, v] of Object.entries(out))
    v.missing = META_PLATFORMS.filter((p) => !v.platforms.includes(p) && targets.some((t) => t.item_id === id && t.platform === p));
  return out;
}

// ── עריכה (טיוטה מקומית; לא נוגעת ב-Zernio) ──

const BOOLS = new Set(["gate_enabled", "email_enabled", "link_enabled"]);

export async function createAutomation() {
  return must(await contentDb().from("content_automations").insert({
    name: "אוטומציה חדשה", link_enabled: true, verify_button: "שלח לי", gate_enabled: false,
  }).select("*").single(), "automation insert");
}

export async function saveAutomation(id: string, patch: Record<string, any>) {
  const vals: Record<string, any> = {};
  for (const f of CONTENT_FIELDS) {
    if (!(f in patch)) continue;
    const v = patch[f];
    vals[f] = BOOLS.has(f) ? Boolean(v) : typeof v === "string" ? v.trim() : v;
  }
  if (vals.trigger_mode && !["keyword", "any"].includes(vals.trigger_mode)) vals.trigger_mode = "keyword";
  if (vals.match_mode && !["exact", "word", "contains"].includes(vals.match_mode)) vals.match_mode = "word";
  vals.updated_at = nowIso();
  return must(await contentDb().from("content_automations").update(vals).eq("id", id).select("*").single(), "automation save");
}

// ── בדיקה ──

async function othersFor(a: Automation, withZernio = true): Promise<{ others: OtherActive[]; warn: string | null }> {
  const others: OtherActive[] = [];
  const bank = must(await contentDb().from("content_automations").select("*").neq("id", a.id).is("archived_at", null), "bank") as any[];
  const linked = new Set((must(await contentDb().from("content_automation_links").select("automation_id").is("unlinked_at", null), "links") as any[]).map((l) => l.automation_id));
  for (const o of bank) {
    if (!linked.has(o.id) && o.status !== "active") continue;
    others.push({
      label: `האוטומציה '${o.name}'`, automationId: o.id, keywords: keywordsOf(o), matchMode: o.match_mode,
      buttons: [o.button_title, o.gate_enabled ? o.verify_button : null].filter(Boolean),
    });
  }
  let warn: string | null = null;
  if (withZernio) {
    try {
      const ours = new Set((must(await contentDb().from("content_automation_links").select("zernio_automation_id").not("zernio_automation_id", "is", null), "ours") as any[]).map((r) => r.zernio_automation_id));
      const oursWf = new Set(bank.concat([a]).flatMap((x: any) => [x.zernio_workflow_id, x.fb_workflow_id]).filter(Boolean));
      if (Object.keys(await metaAccounts()).length) {
        const za = await liveCommentAutomations();
        for (const z of za) {
          if (ours.has(z.id) || !z.isActive) continue;
          others.push({ label: `אוטומציה '${z.name}' ב-Zernio`, keywords: z.keywords || [], matchMode: z.matchMode, buttons: (z.buttons || []).map((b: any) => b.title) });
        }
        const wfs = (await zget<any>("/workflows", { status: "active", limit: 100 })).workflows || [];
        for (const w of wfs) {
          if (oursWf.has(w.id)) continue;
          const full = (await zget<any>(`/workflows/${w.id}`)).workflow || {};
          const kws = (full.nodes || []).filter((n: any) => n.type === "trigger").flatMap((n: any) => n.config?.keywords || []);
          if (kws.length) others.push({ label: `workflow '${w.name}' ב-Zernio`, keywords: [], buttons: kws });
        }
      }
    } catch {
      warn = "לא הצלחתי לבדוק התנגשויות מול Zernio כרגע — נסו שוב לפני ההפעלה.";
    }
  }
  return { others, warn };
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
};

// הגנת בוטים (Cloudflare) חוסמת את השרת שלנו — כתובת IP של דאטה־סנטר — אבל לא
// אדם שלוחץ על הלינק באינסטגרם. 403 כזה אינו לינק שבור, ולכן הוא אזהרה ולא חוסם.
function botWall(r: Response) {
  if (r.headers.get("cf-mitigated")) return true;
  return (r.status === 403 || r.status === 503) && /cloudflare/i.test(r.headers.get("server") || "");
}

async function checkLink(url: string): Promise<{ error?: string; warning?: string } | null> {
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetch(url, { method, redirect: "follow", headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return null;
      if (method === "GET") {
        if (botWall(r)) return { warning: `לא הצלחתי לבדוק את הלינק: הגנת הבוטים של האתר (Cloudflare) חסמה את הבדיקה (${r.status}). בדפדפן הוא אמור להיפתח — כדאי לפתוח אותו פעם אחת לוודא.` };
        return { error: `הלינק מחזיר שגיאה ${r.status}` };
      }
    } catch (e) {
      if (method === "GET") return { error: `הלינק לא נטען (${(e as Error).message})` };
    }
  }
  return { error: "הלינק לא נטען" };
}

export async function validate(id: string, extraTopicItemIds: string[] = []) {
  const a = await getAutomation(id);
  const links = await activeLinks(id);
  const items = await itemsById([...links.map((l) => l.item_id), ...extraTopicItemIds]);
  const topics = Object.values(items).map((it: any) => [it.title, it.caption, it.note].filter(Boolean).join(" "));
  const { others, warn } = await othersFor(a);
  const r = validateAutomation(a, topics, others);
  if (warn) r.warnings.push(warn);
  if (a.link_enabled && a.link && /^https?:\/\//.test(a.link)) {
    const bad = await checkLink(a.link.trim());
    if (bad?.error) r.errors.push(bad.error);
    if (bad?.warning) r.warnings.push(bad.warning);
  }
  const acct = await accountFor("instagram");
  return { ...r, preview: preview(a, acct?.username) };
}

// ── פוסטים שאפשר לקשר ──

function isIgImport(itemId: string, item: any) {
  return item?.source === "instagram" && String(itemId).startsWith("ig-");
}

export async function candidates() {
  const items = must(await contentDb().from("content_items").select("id, data").is("deleted_at", null), "items") as any[];
  const pubs = Object.fromEntries((must(await contentDb().from("content_publications").select("item_id, status, scheduled_for"), "pubs") as any[]).map((p) => [p.item_id, p]));
  const targets = must(await contentDb().from("content_targets").select("item_id, platform, status, platform_post_id").in("platform", META_PLATFORMS), "targets") as any[];
  const links = must(await contentDb().from("content_automation_links").select("item_id, automation_id, platform").is("unlinked_at", null), "links") as any[];
  const out: any[] = [];
  for (const { id, data } of items) {
    const p = pubs[id];
    const mine = targets.filter((t) => t.item_id === id);
    // לאילו רשתות של Meta הפוסט עלה או מתוזמן
    const platforms = META_PLATFORMS.filter((pl) => {
      const t = mine.find((x) => x.platform === pl);
      if (t?.status === "published" && t.platform_post_id) return true;
      if (t && p?.status === "scheduled") return true;
      return pl === "instagram" && isIgImport(id, data);
    });
    if (!platforms.length) continue;
    const published = platforms.some((pl) => {
      const t = mine.find((x) => x.platform === pl);
      return (t?.status === "published" && t.platform_post_id) || (pl === "instagram" && isIgImport(id, data));
    });
    const linked = links.filter((l) => l.item_id === id);
    out.push({
      itemId: id, title: data.title, date: data.date, time: data.time || null,
      state: published ? "published" : "scheduled",
      platforms, linkedTo: linked[0]?.automation_id || null,
      missing: platforms.filter((pl) => !linked.some((l) => linkPlatform(l) === pl)),
    });
  }
  return out.sort((x, y) => String(y.date).localeCompare(String(x.date)));
}

/** מזהה הפוסט ברשת — תמיד מ-Zernio, אף פעם לא מוקלד */
async function platformPostId(itemId: string, item: any, platform: MetaPlatform): Promise<string | null> {
  const t = await targetOf(itemId, platform);
  if (t?.platform_post_id && t.status === "published") return t.platform_post_id;
  if (platform === "instagram" && isIgImport(itemId, item)) {
    const media = String(itemId).slice(3);
    const acct = await accountFor("instagram");
    let cursor: string | undefined;
    for (let i = 0; i < 8; i++) {
      const d = await zget<any>("/inbox/comments", { platform: "instagram", limit: 100, accountId: acct?.id, cursor });
      if ((d.data || []).some((p: any) => String(p.id) === media)) return media;
      cursor = d.pagination?.nextCursor;
      if (!cursor) break;
    }
  }
  return null;
}

function acctOf(a: any): Account {
  return { id: a.id, profileId: a.profileId, username: a.username, profileUrl: a.profileUrl };
}

// ── תכניות (מסכי אישור) ──

/**
 * קישור אוטומציה לפוסט, בכל רשת של Meta שהפוסט עולה אליה ועוד אין בה קישור.
 * פוסט שכבר מקושר באינסטגרם בלבד מקבל כאן גם את פייסבוק.
 */
export async function planLink(automationId: string, itemId: string) {
  const a = await getAutomation(automationId);
  if (a.status === "paused") return { status: 409, json: { error: "האוטומציה מושהית. חדש אותה לפני שמקשרים פוסט חדש." } };
  const accts = await metaAccounts();
  if (!Object.keys(accts).length) return { status: 409, json: { error: "אינסטגרם ופייסבוק לא מחוברים ב-Zernio" } };
  const existing = must(await contentDb().from("content_automation_links").select("automation_id, platform").eq("item_id", itemId).is("unlinked_at", null), "link") as any[];
  if (existing.some((l) => l.automation_id !== automationId))
    return { status: 409, json: { error: "לפוסט הזה כבר מקושרת אוטומציה אחרת. אפשר לקשר לכל פוסט אוטומציה אחת בלבד (מגבלה של Meta)." } };
  const item = (await itemsById([itemId]))[itemId];
  if (!item) return { status: 404, json: { error: "הפוסט לא נמצא" } };
  const v = await validate(automationId, [itemId]);
  if (v.errors.length) return { status: 200, json: { validation: v, blocked: true } };

  const pub = must(await contentDb().from("content_publications").select("*").eq("item_id", itemId).maybeSingle(), "pub") as any;
  const links: { platform: MetaPlatform; mode: "now" | "arm"; body: any }[] = [];
  const skipped: string[] = [];
  for (const p of META_PLATFORMS) {
    if (existing.some((l) => linkPlatform(l) === p)) continue;
    const target = await targetOf(itemId, p);
    if (!target && !(p === "instagram" && isIgImport(itemId, item))) continue;
    const acct = accts[p];
    if (!acct) { skipped.push(`${META_NAMES[p]} לא מחובר ב-Zernio, ולכן שם לא תהיה אוטומציה.`); continue; }
    const postId = await platformPostId(itemId, item, p);
    let mode: "now" | "arm";
    if (postId) mode = "now";
    else if (pub?.status === "scheduled" && target) mode = "arm";
    else { skipped.push(`ב${META_NAMES[p]} הפוסט עוד לא עלה ולא מתוזמן — שם לא תהיה אוטומציה.`); continue; }
    links.push({ platform: p, mode, body: commentAutomationBody(a, acctOf(acct), itemId, postId, p, a.fb_workflow_id) });
  }
  if (!links.length) return { status: 409, json: { error: existing.length
    ? "האוטומציה כבר מקושרת לפוסט בכל הרשתות שהוא עולה אליהן."
    : skipped[0] || "אפשר לקשר רק לפוסט שכבר עלה לאינסטגרם או לפייסבוק, או שתוזמן לאחת מהן מהגאנט." } };

  const workflows: Partial<Record<MetaPlatform, any>> = {};
  const steps: any[] = [];
  for (const l of links) {
    if (!workflowIdOf(a, l.platform)) {
      workflows[l.platform] = workflowBody(a, acctOf(accts[l.platform]), l.platform);
      steps.push(
        { method: "POST", path: "/workflows", body: workflows[l.platform], note: `${META_NAMES[l.platform]}: פעם אחת לאוטומציה — משותף לכל הפוסטים` },
        { method: "POST", path: "/workflows/{id}/activate" },
      );
    }
    if (l.mode === "now") steps.push({ method: "POST", path: "/comment-automations", body: l.body, note: META_NAMES[l.platform] });
    else steps.push(
      { method: "POST", path: "/comment-automations", body: l.body, note: `${META_NAMES[l.platform]}: עובד הרקע, כמה דקות לפני הפרסום — ברמת החשבון לכמה דקות` },
      { method: "PATCH", path: "/comment-automations/{id}", body: { platformPostId: `<מזהה הפוסט ב${META_NAMES[l.platform]}, מ-GET /posts>` }, note: "עובד הרקע, מיד כשהפוסט עולה" },
    );
  }
  const lines = links.map((l) => l.mode === "now"
    ? `${META_NAMES[l.platform]}: האוטומציה '${a.name}' תיצמד עכשיו לפוסט '${item.title}' (שכבר עלה).`
    : `${META_NAMES[l.platform]}: הפוסט '${item.title}' מתוזמן ל-${String(pub.scheduled_for).replace("T", " ")}. הקישור יישמר כ'ממתין', ועובד הרקע ייצור את האוטומציה כמה דקות לפני הפרסום ויצמיד אותה לפוסט ברגע שהוא עולה. אם ההצמדה תיכשל — הוא ישהה אותה ויתריע.`);
  if (a.gate_enabled && links.some((l) => l.platform === "facebook"))
    lines.push("שים לב: בפייסבוק אין בדיקת עוקב. כל מי שמגיב שם יקבל את ההודעה בלי לעבור את בקשת העוקב.");
  lines.push(...skipped);
  const mode = links.every((l) => l.mode === "now") ? "now" : "arm";
  const plan = { automationId, itemId, links, workflows, steps, hash: fingerprint(contentHash(a)) };
  const actionId = await createAction("automation_link", itemId, plan);
  return { status: 200, json: { validation: v, actionId, summary: { text: lines.join("\n"), mode, preview: v.preview }, requests: dryRunView(plan) } };
}

/** workflow אחד לאוטומציה בכל רשת: נוצר בקישור הראשון שם, מופעל, ונשמר */
async function ensureWorkflow(a: any, platform: MetaPlatform, wfBody: any | null, actor: string, itemId: string | null) {
  const existing = workflowIdOf(a, platform);
  if (existing) {
    if (a.status !== "active") {
      // ייתכן שההפעלה הקודמת נכשלה אחרי שה-workflow נוצר
      await zwrite("POST", `/workflows/${existing}/activate`, undefined, { actor, action: "automation: activate workflow", itemId });
      must(await contentDb().from("content_automations").update({ status: "active" }).eq("id", a.id), "automation active");
    }
    return existing;
  }
  if (!wfBody) throw new Error(`חסר ה-workflow לאוטומציה ב${META_NAMES[platform]}`);
  const data = await zwrite<any>("POST", "/workflows", injectKey(wfBody, apiKey()), { actor, action: `automation: create workflow (${platform})`, itemId });
  const id = data.workflow?.id;
  // נרשם מיד: אם משהו אחרי זה נכשל, לא ייווצר workflow כפול בניסיון הבא
  const col = platform === "facebook" ? "fb_workflow_id" : "zernio_workflow_id";
  // טביעת "מה נשלח" נקבעת רק ב-workflow הראשון: אם ברשת השנייה יש שינויים שלא
  // נשלחו, ה-workflow החדש לא מוחק את האזהרה עליהם
  const first = workflowIds(a).length === 0;
  must(await contentDb().from("content_automations").update({ [col]: id, ...(first ? { deployed_hash: contentHash(a) } : {}), updated_at: nowIso() }).eq("id", a.id), "workflow id");
  await zwrite("POST", `/workflows/${id}/activate`, undefined, { actor, action: "automation: activate workflow", itemId });
  must(await contentDb().from("content_automations").update({ status: "active" }).eq("id", a.id), "automation active");
  return id as string;
}

/** יוצר את אוטומציית התגובה לקישור. משמש את המסך (פוסט שעלה) ואת העובד (פוסט מתוזמן). */
export async function createCommentAutomation(linkId: string, body: any, actor: string, opts: { safety?: boolean } = {}) {
  // תופסים את הקישור לפני היצירה: אם בינתיים נותק או הושהה — לא יוצרים כלום
  const claimed = must(await contentDb().from("content_automation_links").update({ status: "creating", updated_at: nowIso() })
    .eq("id", linkId).eq("status", "armed").is("unlinked_at", null).select("item_id"), "claim link") as any[];
  if (!claimed.length) throw new Error("הקישור כבר לא ממתין (נותק או הושהה) — לא נוצר כלום");
  const itemId = claimed[0].item_id;
  let data: any;
  try {
    data = await zwrite<any>("POST", "/comment-automations", body, { actor, action: "automation: create comment automation", itemId, safety: opts.safety });
  } catch (e) {
    // תוצאה לא ודאית (timeout / 5xx): ייתכן שנוצרה. נשאר 'creating', והעובד יחפש אותה לפי השם
    const uncertain = e instanceof ZernioError && (e.status === 0 || e.status >= 500);
    await contentDb().from("content_automation_links").update({
      status: uncertain ? "creating" : "armed", last_error: errText(e), updated_at: nowIso(),
    }).eq("id", linkId);
    throw e;
  }
  const au = data.automation || data;
  const zid = au.id || au._id;
  must(await contentDb().from("content_automation_links").update({
    zernio_automation_id: zid, status: "live", scope: body.platformPostId ? "post" : "account",
    armed_at: nowIso(), scoped_at: body.platformPostId ? nowIso() : null, last_error: null, updated_at: nowIso(),
  }).eq("id", linkId), "link live");
  return zid as string;
}

executor("automation_link", async (plan) => {
  let a = await getAutomation(plan.automationId);
  if (fingerprint(contentHash(a)) !== plan.hash) throw new Error("האוטומציה השתנתה אחרי שמסך האישור נפתח — פתח אותו מחדש");
  // תכנית שנפתחה לפני שהיה פייסבוק: קישור אחד לאינסטגרם
  const specs: { platform: MetaPlatform; mode: "now" | "arm"; body: any }[] = plan.links || [{ platform: "instagram", mode: plan.mode, body: plan.body }];
  const workflows: Partial<Record<MetaPlatform, any>> = plan.workflows || (plan.workflowBody ? { instagram: plan.workflowBody } : {});
  for (const spec of specs) {
    // קודם הקישור במסד, אחר כך Zernio: כך שום דבר שנוצר שם לא נשאר בלי רישום כאן
    const link = must(await contentDb().from("content_automation_links").insert({
      automation_id: a.id, item_id: plan.itemId, platform: spec.platform, status: "armed", approved: spec.body,
    }).select("*").single(), "link insert") as any;
    try {
      const wfId = await ensureWorkflow(a, spec.platform, workflows[spec.platform] || null, "ui", plan.itemId);
      let body = spec.body;
      if (spec.platform === "facebook") {
        body = withFbWorkflow(body, wfId);
        must(await contentDb().from("content_automation_links").update({ approved: body }).eq("id", link.id), "link approved");
      }
      if (spec.mode === "now") await createCommentAutomation(link.id, body, "ui");
    } catch (e) {
      const fresh = must(await contentDb().from("content_automation_links").select("zernio_automation_id").eq("id", link.id).single(), "link") as any;
      await contentDb().from("content_automation_links").update(
        fresh.zernio_automation_id
          ? { status: "error", last_error: errText(e) }
          : { status: "unlinked", unlinked_at: nowIso(), last_error: errText(e) },
      ).eq("id", link.id);
      throw e;
    }
    a = await getAutomation(a.id); // מזהה ה-workflow והסטטוס התעדכנו
  }
  const names = specs.map((x) => META_NAMES[x.platform]).join(" ו");
  const allNow = specs.every((x) => x.mode === "now");
  return { message: allNow ? `האוטומציה פעילה וצמודה לפוסט (${names}).` : `הקישור נשמר (${names}). עובד הרקע ייצור ויצמיד את האוטומציה סביב שעת הפרסום.`, audit: await runHealthSafe() };
});

function errText(e: unknown) {
  return e instanceof ZernioError ? e.hebrew : (e as Error).message;
}

/** עדכון אוטומציה מהבנק בכל הפוסטים המקושרים, במסך אישור אחד */
export async function planUpdate(automationId: string) {
  const a = await getAutomation(automationId);
  const v = await validate(automationId);
  if (v.errors.length) return { status: 200, json: { validation: v, blocked: true } };
  const links = await activeLinks(automationId);
  const accts = await metaAccounts();
  if (!Object.keys(accts).length) return { status: 409, json: { error: "אינסטגרם ופייסבוק לא מחוברים ב-Zernio" } };
  const steps: any[] = [];
  for (const [p, wfId] of workflowIds(a)) {
    if (!accts[p]) return { status: 409, json: { error: `${META_NAMES[p]} לא מחובר ב-Zernio, ויש לאוטומציה workflow שם` } };
    const wf = workflowBody(a, acctOf(accts[p]), p);
    steps.push(
      { method: "POST", path: `/workflows/${wfId}/pause`, note: `${META_NAMES[p]}: אפשר לערוך workflow רק כשהוא מושהה` },
      { method: "PATCH", path: `/workflows/${wfId}`, body: { name: wf.name, description: wf.description, nodes: wf.nodes, edges: wf.edges, entryNodeId: "t1" } },
    );
    if (a.status === "active") steps.push({ method: "POST", path: `/workflows/${wfId}/activate` });
  }
  for (const l of links) if (l.zernio_automation_id)
    steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: commentAutomationPatch(a, linkPlatform(l), a.fb_workflow_id), note: META_NAMES[linkPlatform(l)] });
  const armed = links.filter((l) => !l.zernio_automation_id).length;
  const text = `השינויים יישלחו ל-Zernio: ${workflowIds(a).length ? "ה-workflow יעודכן (השהיה קצרה ואז הפעלה), " : ""}ו-${links.filter((l) => l.zernio_automation_id).length} אוטומציות תגובה יעודכנו.${armed ? ` ${armed} קישורים שממתינים לפרסום יקבלו את הנוסח החדש.` : ""}`;
  const armedBodies: Partial<Record<MetaPlatform, any>> = {};
  for (const p of META_PLATFORMS) if (accts[p]) armedBodies[p] = commentAutomationBody(a, acctOf(accts[p]), "x", null, p, a.fb_workflow_id);
  const plan = { automationId, steps, hash: fingerprint(contentHash(a)), armedBodies };
  const actionId = await createAction("automation_update", null, plan);
  return { status: 200, json: { validation: v, actionId, summary: { text, preview: v.preview }, requests: dryRunView(plan) } };
}

executor("automation_update", async (plan) => {
  const a = await getAutomation(plan.automationId);
  if (fingerprint(contentHash(a)) !== plan.hash) throw new Error("האוטומציה השתנתה אחרי שמסך האישור נפתח — פתחו אותו מחדש");
  const wfPaths = new Set(workflowIds(a).map(([, id]) => `/workflows/${id}`));
  for (const s of plan.steps) {
    const body = wfPaths.has(s.path) && s.method === "PATCH" ? injectKey(s.body, apiKey()) : s.body;
    await zwrite(s.method, s.path, body, { action: `automation update: ${s.method} ${s.path.split("/")[1]}` });
  }
  // קישורים ממתינים: הגוף שאושר מתעדכן לנוסח החדש
  const links = await activeLinks(a.id);
  for (const l of links.filter((x) => !x.zernio_automation_id)) {
    let fresh = (plan.armedBodies || { instagram: plan.armedBody })[linkPlatform(l)];
    if (!fresh) continue;
    if (linkPlatform(l) === "facebook" && a.fb_workflow_id) fresh = withFbWorkflow(fresh, a.fb_workflow_id);
    const approved = { ...fresh, name: l.approved?.name || fresh.name, platformPostId: undefined };
    delete approved.platformPostId;
    await contentDb().from("content_automation_links").update({ approved, updated_at: nowIso() }).eq("id", l.id);
  }
  await contentDb().from("content_automations").update({ deployed_hash: contentHash(a), updated_at: nowIso() }).eq("id", a.id);
  return { message: "האוטומציה עודכנה בכל הפוסטים", audit: await runHealthSafe() };
});

export async function planState(automationId: string, kind: "pause" | "resume" | "delete") {
  const a = await getAutomation(automationId);
  const links = await activeLinks(automationId);
  const steps: any[] = [];
  let text = "";
  if (kind === "pause") {
    for (const l of links) if (l.zernio_automation_id && l.status !== "paused") steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: { isActive: false } });
    steps.push({ method: "PATCH", path: "/comment-automations/{id}", body: { isActive: false }, note: "וגם כל אוטומציה שהעובד יצר עד רגע האישור" });
    for (const [, wfId] of workflowIds(a)) steps.push({ method: "POST", path: `/workflows/${wfId}/pause` });
    text = "השהיה בכל הפוסטים: תגובות חדשות לא יקבלו הודעה, ולחיצות חדשות על הכפתור לא יתחילו את המשפך. מי שכבר באמצע — ימשיך. קישורים שממתינים לפרסום לא ייווצרו.";
  } else if (kind === "resume") {
    for (const [, wfId] of workflowIds(a)) steps.push({ method: "POST", path: `/workflows/${wfId}/activate` });
    for (const l of links) if (l.zernio_automation_id && l.status === "paused") steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: { isActive: true }, note: l.scope === "post" ? undefined : "רק אם הפוסט כבר עלה — ואז גם צמודה אליו" });
    text = "חידוש: האוטומציה תחזור לענות לתגובות חדשות בכל הפוסטים שהיא צמודה אליהם.";
  } else {
    if (links.length) return { status: 409, json: { error: "יש פוסטים מקושרים. נתקו אותם קודם." } };
    for (const [, wfId] of workflowIds(a)) steps.push({ method: "DELETE", path: `/workflows/${wfId}` });
    text = "מחיקת האוטומציה מהבנק" + (workflowIds(a).length ? " ומחיקת ה-workflow שלה ב-Zernio" : "") + ". המיילים שנאספו נשארים.";
  }
  const plan = { automationId, kind, steps, localOnly: steps.length === 0 };
  const actionId = await createAction(`automation_${kind}`, null, plan);
  return { status: 200, json: { actionId, summary: { text }, requests: dryRunView(plan) } };
}

async function runSteps(steps: any[], action: string) {
  for (const s of steps) await zwrite(s.method, s.path, s.body, { action: `${action}: ${s.method} ${s.path.split("/")[1]}` });
}

executor("automation_pause", async (plan) => {
  const t = nowIso();
  // קודם במסד: העובד לא ייצור קישורים ממתינים מרגע זה
  await contentDb().from("content_automations").update({ status: "paused", updated_at: t }).eq("id", plan.automationId);
  await contentDb().from("content_automation_links").update({ status: "paused", updated_at: t }).eq("automation_id", plan.automationId).is("unlinked_at", null).eq("status", "armed");
  // ואז כל מה שחי ב-Zernio *עכשיו*, גם מה שנוצר אחרי שמסך האישור נפתח
  const links = await activeLinks(plan.automationId);
  for (const l of links.filter((x) => x.zernio_automation_id && x.status !== "paused")) {
    await zwrite("PATCH", `/comment-automations/${l.zernio_automation_id}`, { isActive: false }, { action: "automation pause", itemId: l.item_id });
    await contentDb().from("content_automation_links").update({ status: "paused", updated_at: nowIso() }).eq("id", l.id);
  }
  const a = await getAutomation(plan.automationId);
  for (const [, wfId] of workflowIds(a)) await zwrite("POST", `/workflows/${wfId}/pause`, undefined, { action: "automation pause: workflow" });
  return { message: "האוטומציה הושהתה בכל הפוסטים", audit: await runHealthSafe() };
});

executor("automation_resume", async (plan) => {
  const a0 = await getAutomation(plan.automationId);
  for (const [, wfId] of workflowIds(a0)) await zwrite("POST", `/workflows/${wfId}/activate`, undefined, { action: "automation resume: workflow" });
  const t = nowIso();
  const links = await activeLinks(plan.automationId);
  const notes: string[] = [];
  for (const l of links.filter((x) => x.status === "paused")) {
    if (!l.zernio_automation_id) {
      await contentDb().from("content_automation_links").update({ status: "armed", updated_at: t }).eq("id", l.id);
      continue;
    }
    let patch: Record<string, unknown> = { isActive: true };
    if (l.scope !== "post") {
      // הושהתה כי לא הספיקה להיצמד: מחדשים רק אם הפוסט כבר עלה, ומיד צמודה אליו
      const tg = await targetOf(l.item_id, linkPlatform(l));
      if (!(tg?.status === "published" && tg.platform_post_id)) { notes.push(l.item_id); continue; }
      patch = { isActive: true, platformPostId: tg.platform_post_id };
    }
    await zwrite("PATCH", `/comment-automations/${l.zernio_automation_id}`, patch, { action: "automation resume", itemId: l.item_id });
    await contentDb().from("content_automation_links").update({ status: "live", scope: "post", scoped_at: l.scoped_at || t, last_error: null, updated_at: t }).eq("id", l.id);
  }
  await contentDb().from("content_automations").update({ status: "active", updated_at: t }).eq("id", plan.automationId);
  return { message: "האוטומציה חודשה" + (notes.length ? ` (${notes.length} פוסטים עוד לא עלו — נשארו מושהים)` : ""), audit: await runHealthSafe() };
});

executor("automation_delete", async (plan) => {
  await runSteps(plan.steps, "automation delete");
  await contentDb().from("content_automations").update({ archived_at: nowIso(), zernio_workflow_id: null, fb_workflow_id: null }).eq("id", plan.automationId);
  return { message: "האוטומציה נמחקה" };
});

export async function planUnlink(linkId: string) {
  const l = must(await contentDb().from("content_automation_links").select("*").eq("id", linkId).maybeSingle(), "link") as any;
  if (!l || l.unlinked_at) return { status: 404, json: { error: "הקישור לא נמצא" } };
  const steps = [{ method: "DELETE", path: "/comment-automations/{id}", note: l.zernio_automation_id ? `המזהה הנוכחי: ${l.zernio_automation_id}` : "רק אם נוצרה עד רגע האישור" }];
  const text = `ניתוק האוטומציה מהפוסט ב${META_NAMES[linkPlatform(l)]}` + (l.zernio_automation_id
    ? ": אוטומציית התגובה של הפוסט נמחקת ב-Zernio (הלוגים שלה יישמרו כאן). מי שכבר קיבל הודעה לא יקבל שוב לעולם — כלל של Meta."
    : " (עוד לא נוצרה ב-Zernio).");
  const plan = { linkId, itemId: l.item_id, steps, localOnly: !l.zernio_automation_id };
  const actionId = await createAction("automation_unlink", l.item_id, plan);
  return { status: 200, json: { actionId, summary: { text }, requests: dryRunView(plan) } };
}

executor("automation_unlink", async (plan) => {
  const l = must(await contentDb().from("content_automation_links").select("*").eq("id", plan.linkId).single(), "link") as any;
  if (l.zernio_automation_id) {
    try {
      await setMeta(`archived_logs:${l.id}`, await fetchAllLogs(l.zernio_automation_id));
    } catch { /* הלוגים נחמדים לשמור; לא סיבה לעצור ניתוק */ }
  }
  // קודם מסמנים כמנותק (העובד לא ייצור יותר), ואז מוחקים מה שקיים *עכשיו* ב-Zernio —
  // גם אם נוצר אחרי שמסך האישור נפתח
  await contentDb().from("content_automation_links").update({ status: "unlinked", unlinked_at: nowIso(), updated_at: nowIso() }).eq("id", l.id);
  const now = must(await contentDb().from("content_automation_links").select("zernio_automation_id").eq("id", l.id).single(), "link") as any;
  if (now.zernio_automation_id) await zwrite("DELETE", `/comment-automations/${now.zernio_automation_id}`, undefined, { action: "automation unlink", itemId: l.item_id });
  return { message: "האוטומציה נותקה מהפוסט", audit: await runHealthSafe() };
});

// ── מעקב: מספרים, ומיילים → אנשי קשר ב-CRM ──

export async function fetchAllLogs(zid: string, cap = 2000) {
  const out: any[] = [];
  for (let skip = 0; out.length < cap; ) {
    const d = await zget<any>(`/comment-automations/${zid}/logs`, { limit: 200, skip });
    const logs = d.logs || [];
    out.push(...logs);
    if (!logs.length || !d.pagination?.hasMore) break;
    skip += logs.length;
  }
  return out;
}

async function fetchExecutions(wfId: string, cap = 1000) {
  const seen = new Map<string, any>();
  for (let skip = 0, i = 0; i < 20; i++) {
    const d = await zget<any>(`/workflows/${wfId}/executions`, { limit: 100, skip });
    const ex = d.executions || [];
    let fresh = 0;
    for (const e of ex) if (e.id && !seen.has(e.id)) { seen.set(e.id, e); fresh++; }
    // הדפדוף לא אמין (הסקיל): עוצרים ברגע שעמוד לא מביא שום דבר חדש
    if (!ex.length || !fresh || !d.pagination?.hasMore || seen.size >= cap) break;
    skip += ex.length;
  }
  return [...seen.values()];
}

export async function refreshStats(automationId: string) {
  const a = await getAutomation(automationId);
  const links = await activeLinks(automationId);
  let comments = 0, dmsSent = 0, dmsFailed = 0, gated = 0;
  for (const l of links) {
    if (!l.zernio_automation_id) continue;
    const logs = await fetchAllLogs(l.zernio_automation_id);
    const by: Record<string, number> = {};
    for (const lg of logs) by[lg.status || "?"] = (by[lg.status || "?"] || 0) + 1;
    const s = {
      comments: logs.length, dmsSent: by.sent || 0, dmsFailed: by.failed || 0, gated: by.gated || 0,
      recent: logs.slice(0, 15).map((lg) => ({ at: lg.createdAt, who: lg.commenterUsername || lg.commenterName, text: String(lg.commentText || "").slice(0, 80), status: lg.status, error: lg.error })),
    };
    comments += s.comments; dmsSent += s.dmsSent; dmsFailed += s.dmsFailed; gated += s.gated;
    await contentDb().from("content_automation_links").update({ stats: s, stats_at: nowIso() }).eq("id", l.id);
  }
  const ex = { taps: 0, emails: 0, links: 0 };
  let newEmails = 0;
  for (const [p, wfId] of workflowIds(a)) {
    const execs = await fetchExecutions(wfId);
    const one = executionStats(execs);
    ex.taps += one.taps; ex.emails += one.emails; ex.links += one.links;
    for (const e of execs) {
      const email = emailFromVars(e.variables || {});
      if (!email) continue;
      const exists = must(await contentDb().from("content_emails").select("id").eq("execution_id", e.id).maybeSingle(), "email") as any;
      if (exists) continue;
      const contactId = await saveEmailContact(email, a.name, META_NAMES[p]).catch(() => null);
      await contentDb().from("content_emails").insert({
        automation_id: a.id, execution_id: e.id, email, conversation_id: e.conversationId || null, contact_id: contactId,
        collected_at: e.createdAt || nowIso(), raw: { platformIdentifier: e.platformIdentifier || null, platform: p },
      });
      newEmails++;
    }
  }
  const orphans = must(await contentDb().from("content_emails").select("id, email").eq("automation_id", a.id).is("contact_id", null).limit(50), "email retry") as any[];
  for (const o of orphans) {
    const cid = await saveEmailContact(o.email, a.name).catch(() => null);
    if (cid) await contentDb().from("content_emails").update({ contact_id: cid }).eq("id", o.id);
  }
  const stats = { comments, dmsSent, dmsFailed, gated, taps: ex.taps, emails: ex.emails, linksSent: ex.links };
  await contentDb().from("content_automations").update({ stats, stats_at: nowIso() }).eq("id", a.id);
  return { stats, newEmails };
}

export async function emailsOf(automationId: string) {
  return must(await contentDb().from("content_emails").select("email, collected_at, contact_id").eq("automation_id", automationId).order("collected_at", { ascending: false }), "emails") as any[];
}

// ── בדיקת תקינות ──

export async function runHealth() {
  const fails: string[] = [], warns: string[] = [], oks: string[] = [];
  const autos = must(await contentDb().from("content_automations").select("*").is("archived_at", null), "automations") as any[];
  const links = must(await contentDb().from("content_automation_links").select("*").is("unlinked_at", null), "links") as any[];
  const live: Record<string, any> = {};
  for (const z of await liveCommentAutomations()) live[z.id] = z;
  const wfs = Object.fromEntries(((await zget<any>("/workflows", { limit: 100 })).workflows || []).map((w: any) => [w.id, w]));
  const items = await itemsById(links.map((l) => l.item_id));

  for (const z of Object.values(live)) {
    if (z.linkTracking) fails.push(`${z.name}: link tracking פעיל (עטיפת הפניה נקראת כספאם בהודעות)`);
    if (z.isActive && !z.platformPostId && !z.postId && !["story_reply", "story_mention"].includes(z.trigger || "comment"))
      fails.push(`${z.name}: פעילה ברמת החשבון — עונה על כל פוסט שפורסם אי פעם`);
    if ((z.matchMode || "contains") === "contains") for (const kw of z.keywords || []) if (kw.trim().length <= 4) fails.push(`${z.name}: '${kw}' ב-contains ורק ${kw.trim().length} תווים`);
  }
  const known = new Set<string>();
  for (const l of links) {
    const a = autos.find((x) => x.id === l.automation_id);
    const nm = `'${a?.name || "?"}' בפוסט '${items[l.item_id]?.title || l.item_id}' (${META_NAMES[linkPlatform(l)]})`;
    if (l.zernio_automation_id) known.add(l.zernio_automation_id);
    if (l.status === "armed") { oks.push(`${nm}: ממתינה לפרסום`); continue; }
    const z = l.zernio_automation_id ? live[l.zernio_automation_id] : null;
    if (!z) { if (["live", "paused"].includes(l.status)) fails.push(`${nm}: רשומה כ${LINK_STATUS_HE[l.status]}, אבל לא קיימת ב-Zernio`); continue; }
    const before = fails.length;
    if (l.status === "live" && !z.isActive) fails.push(`${nm}: פעילה כאן, מושהית ב-Zernio`);
    if (l.status === "paused" && z.isActive) fails.push(`${nm}: מושהית כאן, פעילה ב-Zernio`);
    if (l.scope === "post" && !z.platformPostId) fails.push(`${nm}: אמורה להיות צמודה לפוסט, אבל ב-Zernio היא ברמת החשבון`);
    if (a && (a.match_mode || "word") !== z.matchMode) fails.push(`${nm}: סוג ההתאמה שונה בין כאן ל-Zernio`);
    if (fails.length === before) oks.push(`${nm}: ${LINK_STATUS_HE[l.status]}, תואם ל-Zernio`);
  }
  for (const a of autos) {
    for (const [p, wfId] of workflowIds(a)) {
      const w = wfs[wfId];
      const where = `'${a.name}' (${META_NAMES[p]})`;
      if (!w) fails.push(`${where}: ה-workflow של הכפתור לא קיים ב-Zernio — לחיצה על הכפתור לא תוביל לשום מקום`);
      else if ((a.status === "active" || links.some((l) => l.automation_id === a.id && linkPlatform(l) === p && l.status === "live")) && w.status !== "active") fails.push(`${where}: ה-workflow של הכפתור במצב ${w.status}, לא פעיל`);
    }
    // קישור חי בפייסבוק בלי workflow לדף: הכפתור לא יוביל לשום מקום
    if (!a.fb_workflow_id && links.some((l) => l.automation_id === a.id && linkPlatform(l) === "facebook" && l.status === "live"))
      fails.push(`'${a.name}': פעילה בפייסבוק, אבל אין לה workflow בדף`);
    if (workflowIds(a).length && a.deployed_hash && a.deployed_hash !== contentHash(a)) warns.push(`'${a.name}': יש שינויים שעוד לא נשלחו ל-Zernio`);
  }
  for (const [zid, z] of Object.entries(live)) if (!known.has(zid)) warns.push(`'${z.name}': קיימת ב-Zernio ולא מנוהלת מהגאנט`);
  const texts: [string, string][] = [];
  for (const a of autos) if (a.status === "active") {
    texts.push([a.button_title, `'${a.name}'`]);
    if (a.gate_enabled && a.verify_button) texts.push([a.verify_button, `'${a.name}' (אימות)`]);
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const [t1, w1] = texts[i], [t2, w2] = texts[j];
    const n1 = norm(t1), n2 = norm(t2);
    if (n1 && n2 && w1.split(" (")[0] !== w2.split(" (")[0] && (n1.includes(n2) || n2.includes(n1)))
      fails.push(`התנגשות כפתורים: '${t1}' (${w1}) ו-'${t2}' (${w2}) — לחיצה אחת תפעיל שני משפכים`);
  }
  const result = { at: Date.now() / 1000, pass: !fails.length, fails, warns, oks };
  await setMeta("last_audit", result);
  return result;
}

export async function runHealthSafe() {
  try {
    return await runHealth();
  } catch (e) {
    return { pass: false, fails: [`הבדיקה לא רצה: ${errText(e)}`], warns: [], oks: [] };
  }
}

export async function lastHealth() {
  return (await getMeta("last_audit")) || {};
}


/**
 * רשת ביטחון לכלל "אף אוטומציה לא נשארת ברמת החשבון": כל אוטומציה של הגאנט
 * (שם שמתחיל ב-gantt-) שפעילה ב-Zernio בלי פוסט — ואינה קישור טרי שהעובד מצמיד
 * עכשיו — מושהית. כך גם מרוץ שלא חשבנו עליו לא משאיר אוטומציה פתוחה.
 * קישור שנשאר 'creating' (יצירה עם תוצאה לא ודאית) מאומץ לפי השם.
 */
export async function sweepOrphans(alert: (level: "error" | "warn", text: string, itemId?: string | null) => void) {
  const live = await liveCommentAutomations();
  const links = must(await contentDb().from("content_automation_links").select("*"), "links") as any[];
  const byZid = new Map(links.filter((l) => l.zernio_automation_id).map((l) => [l.zernio_automation_id, l]));
  let paused = 0;
  for (const z of live) {
    if (!String(z.name || "").startsWith("gantt-") || !z.isActive || z.platformPostId || z.postId) continue;
    const l = byZid.get(z.id);
    if (!l) {
      // אולי זו יצירה שהתשובה עליה אבדה: מאמצים לפי השם
      const cand = links.find((x) => x.status === "creating" && !x.unlinked_at && !x.zernio_automation_id && x.approved?.name === z.name);
      if (cand) {
        await contentDb().from("content_automation_links").update({ zernio_automation_id: z.id, status: "live", scope: "account", armed_at: cand.armed_at || nowIso(), last_error: null, updated_at: nowIso() }).eq("id", cand.id);
        byZid.set(z.id, { ...cand, zernio_automation_id: z.id, status: "live", scope: "account" });
        continue;  // מעכשיו העובד מצמיד אותה, או משהה אחרי 12 דקות
      }
    }
    if (l && !l.unlinked_at && l.status === "live" && l.scope === "account") continue; // בטיפול של rescope
    await zwrite("PATCH", `/comment-automations/${z.id}`, { isActive: false }, { actor: "worker", action: "automation: pause orphan account-wide", itemId: l?.item_id ?? null, safety: true });
    if (l && !l.unlinked_at) await contentDb().from("content_automation_links").update({ status: "paused", last_error: "נמצאה פעילה ברמת החשבון בלי פוסט — הושהתה.", updated_at: nowIso() }).eq("id", l.id);
    alert("error", `אוטומציה '${z.name}' נמצאה פעילה ברמת החשבון בלי פוסט — הושהתה.`, l?.item_id ?? null);
    paused++;
  }
  // 'creating' שלא נמצא ב-Zernio אחרי 10 דקות: לא נוצר — חוזר להמתנה
  for (const l of links.filter((x) => x.status === "creating" && !x.zernio_automation_id && !x.unlinked_at)) {
    if (Date.now() - Date.parse(l.updated_at) > 10 * 60_000)
      await contentDb().from("content_automation_links").update({ status: "armed", updated_at: nowIso() }).eq("id", l.id);
  }
  return paused;
}
