import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getMeta, getSettings, must, nowIso, setMeta } from "./db";
import { apiKey, zget, zwrite, ZernioError } from "./zernio";
import { accountFor } from "./accounts";
import { createAction, dryRunView, executor, fingerprint } from "./actions";
import {
  commentAutomationBody, commentAutomationPatch, contentHash, CONTENT_FIELDS, emailFromVars, executionStats,
  injectKey, keywordsOf, norm, preview, validateAutomation, workflowBody, type Account, type Automation, type OtherActive,
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
    id: l.id, itemId: l.item_id, status: l.status, statusHe: LINK_STATUS_HE[l.status] || l.status, scope: l.scope,
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
  const out: Record<string, any> = {};
  for (const l of links) {
    let overdue = false;
    if (l.status === "armed" && due[l.item_id]) {
      const t = zonedToUtc(due[l.item_id], timezone);
      overdue = Boolean(t && Date.now() > t.getTime() + 2 * 60_000);
    }
    out[l.item_id] = {
      automationId: l.automation_id, name: l.content_automations?.name, status: l.status,
      statusHe: LINK_STATUS_HE[l.status] || l.status, overdue, stats: l.stats,
    };
  }
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
      const oursWf = new Set(bank.concat([a]).map((x: any) => x.zernio_workflow_id).filter(Boolean));
      const acct = await accountFor("instagram");
      if (acct) {
        const za = (await zget<any>("/comment-automations", { profileId: acct.profileId })).automations || [];
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

async function checkLink(url: string): Promise<string | null> {
  for (const method of ["HEAD", "GET"]) {
    try {
      const r = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (content-gantt link check)" }, signal: AbortSignal.timeout(15_000) });
      if (r.ok) return null;
      if (method === "GET") return `הלינק מחזיר שגיאה ${r.status}`;
    } catch (e) {
      if (method === "GET") return `הלינק לא נטען (${(e as Error).message})`;
    }
  }
  return "הלינק לא נטען";
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
    if (bad) r.errors.push(bad);
  }
  const acct = await accountFor("instagram");
  return { ...r, preview: preview(a, acct?.username) };
}

// ── פוסטים שאפשר לקשר ──

export async function candidates() {
  const items = must(await contentDb().from("content_items").select("id, data").is("deleted_at", null), "items") as any[];
  const pubs = Object.fromEntries((must(await contentDb().from("content_publications").select("item_id, status, scheduled_for"), "pubs") as any[]).map((p) => [p.item_id, p]));
  const ig = Object.fromEntries((must(await contentDb().from("content_targets").select("item_id, status, platform_post_id").eq("platform", "instagram"), "targets") as any[]).map((t) => [t.item_id, t]));
  const linked = Object.fromEntries((must(await contentDb().from("content_automation_links").select("item_id, automation_id").is("unlinked_at", null), "links") as any[]).map((l) => [l.item_id, l.automation_id]));
  const out: any[] = [];
  for (const { id, data } of items) {
    const t = ig[id];
    const p = pubs[id];
    let state: string | null = null;
    if (t?.status === "published" && t.platform_post_id) state = "published";
    else if (t && p?.status === "scheduled") state = "scheduled";
    else if (data.source === "instagram" && String(id).startsWith("ig-")) state = "published";
    if (!state) continue;
    out.push({ itemId: id, title: data.title, date: data.date, time: data.time || null, state, linkedTo: linked[id] || null });
  }
  return out.sort((x, y) => String(y.date).localeCompare(String(x.date)));
}

/** מזהה הפוסט באינסטגרם — תמיד מ-Zernio, אף פעם לא מוקלד */
async function instagramPostId(itemId: string, item: any): Promise<string | null> {
  const t = must(await contentDb().from("content_targets").select("platform_post_id, status").eq("item_id", itemId).eq("platform", "instagram").maybeSingle(), "target") as any;
  if (t?.platform_post_id && t.status === "published") return t.platform_post_id;
  if (item?.source === "instagram" && String(itemId).startsWith("ig-")) {
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

export async function planLink(automationId: string, itemId: string) {
  const a = await getAutomation(automationId);
  const acct = await accountFor("instagram");
  if (!acct) return { status: 409, json: { error: "אינסטגרם לא מחובר ב-Zernio" } };
  const existing = must(await contentDb().from("content_automation_links").select("automation_id").eq("item_id", itemId).is("unlinked_at", null).maybeSingle(), "link") as any;
  if (existing) return { status: 409, json: { error: "לפוסט הזה כבר מקושרת אוטומציה. אפשר לקשר לכל פוסט אוטומציה אחת בלבד (מגבלה של אינסטגרם)." } };
  const item = (await itemsById([itemId]))[itemId];
  if (!item) return { status: 404, json: { error: "הפוסט לא נמצא" } };
  const v = await validate(automationId, [itemId]);
  if (v.errors.length) return { status: 200, json: { validation: v, blocked: true } };

  const postId = await instagramPostId(itemId, item);
  const pub = must(await contentDb().from("content_publications").select("*").eq("item_id", itemId).maybeSingle(), "pub") as any;
  const igTarget = must(await contentDb().from("content_targets").select("status").eq("item_id", itemId).eq("platform", "instagram").maybeSingle(), "t") as any;
  let mode: "now" | "arm";
  if (postId) mode = "now";
  else if (pub?.status === "scheduled" && igTarget) mode = "arm";
  else return { status: 409, json: { error: "אפשר לקשר רק לפוסט אינסטגרם שכבר עלה, או שתוזמן לאינסטגרם מהגאנט." } };

  const wf = a.zernio_workflow_id ? null : workflowBody(a, acctOf(acct));
  const body = commentAutomationBody(a, acctOf(acct), itemId, postId);
  const steps: any[] = [];
  if (wf) steps.push({ method: "POST", path: "/workflows", body: wf, note: "פעם אחת לאוטומציה — משותף לכל הפוסטים" }, { method: "POST", path: "/workflows/{id}/activate" });
  if (mode === "now") steps.push({ method: "POST", path: "/comment-automations", body });
  else steps.push(
    { method: "POST", path: "/comment-automations", body, note: `עובד הרקע, ${3} דקות לפני הפרסום — ברמת החשבון לכמה דקות` },
    { method: "PATCH", path: "/comment-automations/{id}", body: { platformPostId: "<מזהה הפוסט באינסטגרם, מ-GET /posts>" }, note: "עובד הרקע, מיד כשהפוסט עולה" },
  );
  const text = mode === "now"
    ? `האוטומציה '${a.name}' תיצמד עכשיו לפוסט '${item.title}' (שכבר עלה).`
    : `הפוסט '${item.title}' מתוזמן ל-${String(pub.scheduled_for).replace("T", " ")}. הקישור יישמר כ'ממתין', ועובד הרקע ייצור את האוטומציה כמה דקות לפני הפרסום ויצמיד אותה לפוסט ברגע שהוא עולה. אם ההצמדה תיכשל — הוא ישהה אותה ויתריע.`;
  const plan = { automationId, itemId, mode, steps, workflowBody: wf, body, hash: fingerprint(contentHash(a)) };
  const actionId = await createAction("automation_link", itemId, plan);
  return { status: 200, json: { validation: v, actionId, summary: { text, mode, preview: v.preview }, requests: dryRunView(plan) } };
}

/** workflow אחד לאוטומציה: נוצר בקישור הראשון, מופעל, ונשמר */
async function ensureWorkflow(a: any, wfBody: any | null, actor: string, itemId: string | null) {
  if (a.zernio_workflow_id) return a.zernio_workflow_id as string;
  if (!wfBody) throw new Error("חסר ה-workflow לאוטומציה");
  const data = await zwrite<any>("POST", "/workflows", injectKey(wfBody, apiKey()), { actor, action: "automation: create workflow", itemId });
  const id = data.workflow?.id;
  // נרשם מיד: אם משהו אחרי זה נכשל, לא ייווצר workflow כפול בניסיון הבא
  must(await contentDb().from("content_automations").update({ zernio_workflow_id: id, deployed_hash: contentHash(a), updated_at: nowIso() }).eq("id", a.id), "workflow id");
  await zwrite("POST", `/workflows/${id}/activate`, undefined, { actor, action: "automation: activate workflow", itemId });
  must(await contentDb().from("content_automations").update({ status: "active" }).eq("id", a.id), "automation active");
  return id as string;
}

/** יוצר את אוטומציית התגובה לקישור. משמש את המסך (פוסט שעלה) ואת העובד (פוסט מתוזמן). */
export async function createCommentAutomation(linkId: string, body: any, actor: string, opts: { safety?: boolean } = {}) {
  const l = must(await contentDb().from("content_automation_links").select("*").eq("id", linkId).single(), "link") as any;
  const data = await zwrite<any>("POST", "/comment-automations", body, { actor, action: "automation: create comment automation", itemId: l.item_id, safety: opts.safety });
  const au = data.automation || data;
  const zid = au.id || au._id;
  must(await contentDb().from("content_automation_links").update({
    zernio_automation_id: zid, status: "live", scope: body.platformPostId ? "post" : "account",
    armed_at: nowIso(), scoped_at: body.platformPostId ? nowIso() : null, last_error: null, updated_at: nowIso(),
  }).eq("id", linkId), "link live");
  return zid as string;
}

executor("automation_link", async (plan) => {
  const a = await getAutomation(plan.automationId);
  if (fingerprint(contentHash(a)) !== plan.hash) throw new Error("האוטומציה השתנתה אחרי שמסך האישור נפתח — פתחו אותו מחדש");
  // קודם הקישור במסד, אחר כך Zernio: כך שום דבר שנוצר שם לא נשאר בלי רישום כאן
  const link = must(await contentDb().from("content_automation_links").insert({
    automation_id: a.id, item_id: plan.itemId, status: "armed", approved: plan.body,
  }).select("*").single(), "link insert") as any;
  try {
    await ensureWorkflow(a, plan.workflowBody, "ui", plan.itemId);
    if (plan.mode === "now") await createCommentAutomation(link.id, plan.body, "ui");
  } catch (e) {
    const fresh = must(await contentDb().from("content_automation_links").select("zernio_automation_id").eq("id", link.id).single(), "link") as any;
    await contentDb().from("content_automation_links").update(
      fresh.zernio_automation_id
        ? { status: "error", last_error: errText(e) }
        : { status: "unlinked", unlinked_at: nowIso(), last_error: errText(e) },
    ).eq("id", link.id);
    throw e;
  }
  return { message: plan.mode === "now" ? "האוטומציה פעילה וצמודה לפוסט." : "הקישור נשמר כממתין. עובד הרקע ייצור ויצמיד את האוטומציה סביב שעת הפרסום.", audit: await runHealthSafe() };
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
  const acct = await accountFor("instagram");
  if (!acct) return { status: 409, json: { error: "אינסטגרם לא מחובר ב-Zernio" } };
  const steps: any[] = [];
  if (a.zernio_workflow_id) {
    const wf = workflowBody(a, acctOf(acct));
    steps.push(
      { method: "POST", path: `/workflows/${a.zernio_workflow_id}/pause`, note: "אפשר לערוך workflow רק כשהוא מושהה" },
      { method: "PATCH", path: `/workflows/${a.zernio_workflow_id}`, body: { name: wf.name, description: wf.description, nodes: wf.nodes, edges: wf.edges, entryNodeId: "t1" } },
    );
    if (a.status === "active") steps.push({ method: "POST", path: `/workflows/${a.zernio_workflow_id}/activate` });
  }
  const patch = commentAutomationPatch(a);
  for (const l of links) if (l.zernio_automation_id) steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: patch });
  const armed = links.filter((l) => !l.zernio_automation_id).length;
  const text = `השינויים יישלחו ל-Zernio: ${a.zernio_workflow_id ? "ה-workflow יעודכן (השהיה קצרה ואז הפעלה), " : ""}ו-${links.filter((l) => l.zernio_automation_id).length} אוטומציות תגובה יעודכנו.${armed ? ` ${armed} קישורים שממתינים לפרסום יקבלו את הנוסח החדש.` : ""}`;
  const plan = { automationId, steps, hash: fingerprint(contentHash(a)), armedBody: commentAutomationBody(a, acctOf(acct), "x") };
  const actionId = await createAction("automation_update", null, plan);
  return { status: 200, json: { validation: v, actionId, summary: { text, preview: v.preview }, requests: dryRunView(plan) } };
}

executor("automation_update", async (plan) => {
  const a = await getAutomation(plan.automationId);
  if (fingerprint(contentHash(a)) !== plan.hash) throw new Error("האוטומציה השתנתה אחרי שמסך האישור נפתח — פתחו אותו מחדש");
  for (const s of plan.steps) {
    const body = s.path.endsWith(a.zernio_workflow_id) && s.method === "PATCH" ? injectKey(s.body, apiKey()) : s.body;
    await zwrite(s.method, s.path, body, { action: `automation update: ${s.method} ${s.path.split("/")[1]}` });
  }
  // קישורים ממתינים: הגוף שאושר מתעדכן לנוסח החדש
  const links = await activeLinks(a.id);
  for (const l of links.filter((x) => !x.zernio_automation_id)) {
    const approved = { ...plan.armedBody, name: l.approved?.name || plan.armedBody.name, platformPostId: undefined };
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
    for (const l of links) if (l.zernio_automation_id && l.status === "live") steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: { isActive: false } });
    if (a.zernio_workflow_id) steps.push({ method: "POST", path: `/workflows/${a.zernio_workflow_id}/pause` });
    text = "השהיה בכל הפוסטים: תגובות חדשות לא יקבלו הודעה, ולחיצות חדשות על הכפתור לא יתחילו את המשפך. מי שכבר באמצע — ימשיך. קישורים שממתינים לפרסום לא ייווצרו.";
  } else if (kind === "resume") {
    if (a.zernio_workflow_id) steps.push({ method: "POST", path: `/workflows/${a.zernio_workflow_id}/activate` });
    for (const l of links) if (l.zernio_automation_id && l.scope === "post") steps.push({ method: "PATCH", path: `/comment-automations/${l.zernio_automation_id}`, body: { isActive: true } });
    text = "חידוש: האוטומציה תחזור לענות לתגובות חדשות בכל הפוסטים שהיא צמודה אליהם.";
  } else {
    if (links.length) return { status: 409, json: { error: "יש פוסטים מקושרים. נתקו אותם קודם." } };
    if (a.zernio_workflow_id) steps.push({ method: "DELETE", path: `/workflows/${a.zernio_workflow_id}` });
    text = "מחיקת האוטומציה מהבנק" + (a.zernio_workflow_id ? " ומחיקת ה-workflow שלה ב-Zernio" : "") + ". המיילים שנאספו נשארים.";
  }
  const plan = { automationId, kind, steps, localOnly: steps.length === 0 };
  const actionId = await createAction(`automation_${kind}`, null, plan);
  return { status: 200, json: { actionId, summary: { text }, requests: dryRunView(plan) } };
}

async function runSteps(steps: any[], action: string) {
  for (const s of steps) await zwrite(s.method, s.path, s.body, { action: `${action}: ${s.method} ${s.path.split("/")[1]}` });
}

executor("automation_pause", async (plan) => {
  await runSteps(plan.steps, "automation pause");
  const t = nowIso();
  await contentDb().from("content_automation_links").update({ status: "paused", updated_at: t }).eq("automation_id", plan.automationId).is("unlinked_at", null).in("status", ["live", "armed"]);
  await contentDb().from("content_automations").update({ status: "paused", updated_at: t }).eq("id", plan.automationId);
  return { message: "האוטומציה הושהתה בכל הפוסטים", audit: await runHealthSafe() };
});

executor("automation_resume", async (plan) => {
  await runSteps(plan.steps, "automation resume");
  const t = nowIso();
  const links = await activeLinks(plan.automationId);
  for (const l of links.filter((x) => x.status === "paused")) {
    await contentDb().from("content_automation_links").update({ status: l.zernio_automation_id ? "live" : "armed", updated_at: t }).eq("id", l.id);
  }
  await contentDb().from("content_automations").update({ status: "active", updated_at: t }).eq("id", plan.automationId);
  return { message: "האוטומציה חודשה", audit: await runHealthSafe() };
});

executor("automation_delete", async (plan) => {
  await runSteps(plan.steps, "automation delete");
  await contentDb().from("content_automations").update({ archived_at: nowIso(), zernio_workflow_id: null }).eq("id", plan.automationId);
  return { message: "האוטומציה נמחקה" };
});

export async function planUnlink(linkId: string) {
  const l = must(await contentDb().from("content_automation_links").select("*").eq("id", linkId).maybeSingle(), "link") as any;
  if (!l || l.unlinked_at) return { status: 404, json: { error: "הקישור לא נמצא" } };
  const steps = l.zernio_automation_id ? [{ method: "DELETE", path: `/comment-automations/${l.zernio_automation_id}` }] : [];
  const text = "ניתוק האוטומציה מהפוסט" + (l.zernio_automation_id
    ? ": אוטומציית התגובה של הפוסט נמחקת ב-Zernio (הלוגים שלה יישמרו כאן). מי שכבר קיבל הודעה לא יקבל שוב לעולם — כלל של אינסטגרם."
    : " (עוד לא נוצרה ב-Zernio).");
  const plan = { linkId, itemId: l.item_id, steps, localOnly: steps.length === 0 };
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
  await runSteps(plan.steps, "automation unlink");
  await contentDb().from("content_automation_links").update({ status: "unlinked", unlinked_at: nowIso(), updated_at: nowIso() }).eq("id", l.id);
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
  let ex = { taps: 0, emails: 0, links: 0 };
  let newEmails = 0;
  if (a.zernio_workflow_id) {
    const execs = await fetchExecutions(a.zernio_workflow_id);
    ex = executionStats(execs);
    for (const e of execs) {
      const email = emailFromVars(e.variables || {});
      if (!email) continue;
      const exists = must(await contentDb().from("content_emails").select("id").eq("execution_id", e.id).maybeSingle(), "email") as any;
      if (exists) continue;
      const contactId = await saveEmailContact(email, a.name).catch(() => null);
      await contentDb().from("content_emails").insert({
        automation_id: a.id, execution_id: e.id, email, conversation_id: e.conversationId || null, contact_id: contactId,
        collected_at: e.createdAt || nowIso(), raw: { platformIdentifier: e.platformIdentifier || null },
      });
      newEmails++;
    }
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
  const acct = await accountFor("instagram");
  const live: Record<string, any> = {};
  if (acct) for (const z of (await zget<any>("/comment-automations", { profileId: acct.profileId })).automations || []) live[z.id] = z;
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
    const nm = `'${a?.name || "?"}' בפוסט '${items[l.item_id]?.title || l.item_id}'`;
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
    if (!a.zernio_workflow_id) continue;
    const w = wfs[a.zernio_workflow_id];
    if (!w) fails.push(`'${a.name}': ה-workflow של הכפתור לא קיים ב-Zernio — לחיצה על הכפתור לא תוביל לשום מקום`);
    else if (a.status === "active" && w.status !== "active") fails.push(`'${a.name}': ה-workflow של הכפתור במצב ${w.status}, לא פעיל`);
    if (a.deployed_hash && a.deployed_hash !== contentHash(a)) warns.push(`'${a.name}': יש שינויים שעוד לא נשלחו ל-Zernio`);
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
