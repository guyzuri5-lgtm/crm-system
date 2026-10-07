import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getSettings, must, nowIso, setMeta, tryLease } from "./db";
import { redact, writesEnabled, zget, zwrite, ZernioError } from "./zernio";
import { fetchAccounts, healthy } from "./accounts";
import { syncActive, syncOne } from "./publishing";
import { createCommentAutomation, getAutomation, refreshStats, runHealthSafe, sweepOrphans } from "./automations";
import { PLATFORM_NAMES, zonedToUtc } from "./pure/platforms";

/**
 * עובד הרקע. pg_cron קורא לו כל דקה (0046_content_worker_cron.sql).
 *
 * הוא עושה רק מה שהבעלים כבר אישר במסך אישור:
 *  - מרענן סטטוס של פוסטים מתוזמנים (GET);
 *  - בודק שכל רשת עדיין מחוברת, ומתריע מראש כשפוסט מתוזמן מיועד לרשת שהתנתקה;
 *  - קישור "ממתין": כמה דקות לפני הפרסום יוצר את אוטומציית התגובה ברמת החשבון,
 *    וברגע שלפוסט יש מזהה באינסטגרם — מצמיד אותה אליו (rescope_on_publish.py).
 *    אם זה לא קורה תוך כמה דקות, או שהפוסט נכשל — משהה אותה ומתריע. אוטומציה
 *    אסור שתישאר ברמת החשבון;
 *  - כל 15 דקות: מספרים, ומיילים שנאספו → אנשי קשר.
 * יצירה חדשה מכבדת את המתג הראשי. השהיה והצמדה לפוסט רצות גם כשהוא כבוי.
 */

const MAX_ACCOUNT_WIDE_MS = 12 * 60_000;
const STATS_EVERY_MS = 15 * 60_000;

interface Alert { level: "error" | "warn"; text: string; itemId?: string | null; at: number }

export async function runWorker(opts: { dry?: boolean; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 50_000;
  const alerts: Alert[] = [];
  const log: string[] = [];
  let ok = true;
  const alert = (level: Alert["level"], text: string, itemId?: string | null) => {
    alerts.push({ level, text, itemId: itemId ?? null, at: Date.now() / 1000 });
    log.push(`ALERT ${text}`);
  };
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      ok = false;
      alert("error", `העובד (${name}) נכשל: ${redact(e instanceof ZernioError ? e.hebrew : (e as Error).message)}`);
      return undefined;
    }
  };

  if (!(await tryLease("worker_lock", 75))) return { ok: true, skipped: "another run is in progress" };

  // בטיחות קודם: כל מה שברמת החשבון מטופל לפני כל דבר איטי
  let pending = (await step("rescope", () => rescope(alert, log, opts.dry))) || 0;
  if (!opts.dry) await step("sweep", async () => { const n = await sweepOrphans(alert); if (n) log.push(`paused ${n} orphan(s)`); });
  await step("arm", () => armDue(alert, log, opts.dry));
  pending = (await step("rescope", () => rescope(alert, log, opts.dry))) || 0;
  // האיטיים בסוף, ורק כל עוד יש זמן: שום דבר מהם לא קריטי לכלל "לא ברמת החשבון"
  if (Date.now() - started < budget - 25_000) await step("accounts", () => checkAccounts(alert));
  if (Date.now() - started < budget - 20_000) await step("sync", () => syncActive(50_000, started + budget - 15_000));
  // כל שנייה בין הפרסום להצמדה היא תגובה שהאוטומציה ברמת החשבון עונה עליה לבד
  while (pending && !opts.dry && Date.now() - started < budget - 15_000) {
    await new Promise((r) => setTimeout(r, 10_000));
    pending = (await step("rescope", () => rescope(alert, log, opts.dry))) || 0;
  }
  if (Date.now() - started < budget - 10_000) await step("stats", () => stats(log));
  if (log.some((l) => !l.startsWith("stats")) && !opts.dry) await runHealthSafe();

  const summary = redact(log.slice(-8).join("; ")).slice(0, 1000) || "אין מה לעשות";
  await setMeta("alerts", alerts);
  if (!opts.dry) await setMeta("worker_last", { at: Date.now() / 1000, ok, summary });
  return { ok, summary, alerts: alerts.length };
}

async function checkAccounts(alert: (l: Alert["level"], t: string, i?: string | null) => void) {
  const accs = await fetchAccounts(true);
  const byId = new Map(accs.map((a) => [a.id, a]));
  const pubs = must(await contentDb().from("content_publications").select("item_id, scheduled_for").eq("status", "scheduled"), "scheduled") as any[];
  if (!pubs.length) return;
  const when = Object.fromEntries(pubs.map((p) => [p.item_id, String(p.scheduled_for || "").replace("T", " ")]));
  const rows = must(await contentDb().from("content_targets").select("item_id, platform, account_id").in("item_id", Object.keys(when)), "scheduled targets") as any[];
  for (const r of rows) {
    const a = byId.get(r.account_id);
    const net = PLATFORM_NAMES[r.platform] || r.platform;
    if (!a) alert("error", `פוסט מתוזמן ל-${when[r.item_id]} מיועד ל${net}, אבל החשבון כבר לא מחובר ב-Zernio — הוא ייכשל. חברו מחדש.`, r.item_id);
    else if (!healthy(a)) alert("error", `החשבון ב${net} (@${a.username}) דורש חיבור מחדש ב-Zernio — הפוסט של ${when[r.item_id]} עלול להיכשל.`, r.item_id);
  }
}

async function setLink(id: string, patch: Record<string, unknown>) {
  must(await contentDb().from("content_automation_links").update({ ...patch, updated_at: nowIso() }).eq("id", id), "link update");
}

async function armDue(alert: (l: Alert["level"], t: string, i?: string | null) => void, log: string[], dry?: boolean) {
  const { timezone, armLeadMinutes } = await getSettings();
  const links = must(await contentDb().from("content_automation_links").select("*").eq("status", "armed").is("unlinked_at", null), "armed") as any[];
  for (const l of links) {
    const a = await getAutomation(l.automation_id);
    if (a.status === "paused") continue;
    const pub = must(await contentDb().from("content_publications").select("*").eq("item_id", l.item_id).maybeSingle(), "pub") as any;
    if (!pub || ["cancelled", "failed"].includes(pub.status)) {
      await setLink(l.id, { status: "error", last_error: `הפוסט ${pub?.status === "cancelled" ? "בוטל" : pub?.status === "failed" ? "נכשל" : "לא קיים"} — האוטומציה לא נוצרה.` });
      alert("warn", `אוטומציה '${a.name}' לא נוצרה: הפוסט ${pub?.status || "לא קיים"}.`, l.item_id);
      continue;
    }
    const due = zonedToUtc(String(pub.scheduled_for || ""), timezone);
    if (!due || Date.now() < due.getTime() - armLeadMinutes * 60_000) continue;
    const t = must(await contentDb().from("content_targets").select("platform_post_id, status").eq("item_id", l.item_id).eq("platform", "instagram").maybeSingle(), "ig target") as any;
    if (!t) {
      await setLink(l.id, { status: "error", last_error: "אינסטגרם הוסר מהפוסט — האוטומציה לא נוצרה." });
      alert("warn", `אוטומציה '${a.name}' לא נוצרה: הפוסט כבר לא עולה לאינסטגרם.`, l.item_id);
      continue;
    }
    // באיחור: לפוסט כבר יש מזהה → יוצרים ישר צמודה לפוסט, בלי שלב ברמת החשבון
    const postScoped = t.status === "published" && t.platform_post_id ? t.platform_post_id : null;
    const body = { ...(l.approved || {}) };
    if (postScoped) body.platformPostId = postScoped;
    else delete body.platformPostId;
    const what = postScoped ? "צמודה לפוסט (הפוסט כבר עלה)" : "ברמת החשבון, עד שהפוסט עולה";
    if (dry) { log.push(`would create '${a.name}' ${what}`); continue; }
    if (!(await writesEnabled())) {
      await setLink(l.id, { last_error: "כתיבה ל-Zernio כבויה — האוטומציה לא נוצרה. הפעילו כתיבה במסך 'חיבור ל-Zernio'." });
      alert("error", `אוטומציה '${a.name}' צריכה להיווצר עכשיו, אבל כתיבה ל-Zernio כבויה.`, l.item_id);
      continue;
    }
    try {
      await createCommentAutomation(l.id, body, "worker");
      log.push(`created '${a.name}' ${what}`);
    } catch (e) {
      // createCommentAutomation כבר קבע את המצב (חזרה להמתנה, או 'creating' כשהתוצאה לא ודאית)
      const msg = e instanceof ZernioError ? e.hebrew : (e as Error).message;
      if (msg.includes("כבר לא ממתין")) continue;
      alert("error", `יצירת האוטומציה '${a.name}' נכשלה: ${msg}. ננסה שוב בדקה הבאה.`, l.item_id);
    }
  }
}

/** השהיה של אוטומציה שלא הצליחה להיצמד. חייבת לרוץ גם כשהמתג כבוי. */
async function pauseLink(l: any, reason: string, alert: (l: Alert["level"], t: string, i?: string | null) => void) {
  try {
    await zwrite("PATCH", `/comment-automations/${l.zernio_automation_id}`, { isActive: false },
      { actor: "worker", action: "automation: pause (could not scope)", itemId: l.item_id, safety: true });
    await setLink(l.id, { status: "paused", last_error: `${reason} — האוטומציה הושהתה.` });
    alert("error", `${reason}. האוטומציה בפוסט הזה הושהתה כדי לא להישאר ברמת החשבון.`, l.item_id);
  } catch (e) {
    // scope נשאר 'account': הריצה הבאה, בעוד דקה, תנסה שוב
    await setLink(l.id, { status: "error", last_error: `${reason}. ההשהיה נכשלה (${(e as Error).message}) — מנסה שוב כל דקה. אפשר גם להשהות ידנית ב-Zernio.` });
    alert("error", "אוטומציה ברמת החשבון ולא הצלחתי להשהות אותה! מנסה שוב כל דקה. אפשר להשהות ידנית ב-Zernio.", l.item_id);
  }
}

async function rescope(alert: (l: Alert["level"], t: string, i?: string | null) => void, log: string[], dry?: boolean) {
  // גם 'error': השהיה שנכשלה מנוסה שוב עד שהיא נתפסת
  const links = must(await contentDb().from("content_automation_links").select("*").in("status", ["live", "error"])
    .eq("scope", "account").not("zernio_automation_id", "is", null).is("unlinked_at", null), "account-wide") as any[];
  let pending = 0;
  for (const l of links) {
    await syncOne(l.item_id).catch(() => null);
    const t = must(await contentDb().from("content_targets").select("platform_post_id, status").eq("item_id", l.item_id).eq("platform", "instagram").maybeSingle(), "t") as any;
    const pub = must(await contentDb().from("content_publications").select("status").eq("item_id", l.item_id).maybeSingle(), "pub") as any;
    if (t?.platform_post_id && t.status === "published") {
      if (dry) { log.push(`would scope ${l.id} to ${t.platform_post_id}`); continue; }
      try {
        // צמצום לפוסט הוא הגנה: רץ גם כשהמתג כבוי
        await zwrite("PATCH", `/comment-automations/${l.zernio_automation_id}`, { platformPostId: t.platform_post_id },
          { actor: "worker", action: "automation: scope to published post", itemId: l.item_id, safety: true });
        const check = (await zget<any>(`/comment-automations/${l.zernio_automation_id}`)).automation || {};
        if (check.platformPostId !== t.platform_post_id) throw new Error(`PATCH הצליח אבל ההיקף הוא ${check.platformPostId}`);
        await setLink(l.id, { status: "live", scope: "post", scoped_at: nowIso(), last_error: null });
        log.push(`scoped ${l.id} to ${t.platform_post_id}`);
      } catch (e) {
        await pauseLink(l, `ההצמדה לפוסט נכשלה (${e instanceof ZernioError ? e.hebrew : (e as Error).message})`, alert);
      }
      continue;
    }
    const failed = (t && ["failed", "cancelled"].includes(t.status)) || (pub && ["failed", "cancelled"].includes(pub.status));
    const age = Date.now() - (l.armed_at ? Date.parse(l.armed_at) : Date.now());
    if (failed) { if (!dry) await pauseLink(l, `הפוסט באינסטגרם ${t?.status === "failed" ? "נכשל" : "בוטל"}`, alert); }
    else if (age > MAX_ACCOUNT_WIDE_MS) { if (!dry) await pauseLink(l, "הפוסט לא עלה 12 דקות אחרי שהאוטומציה נוצרה", alert); }
    else pending++;
  }
  return pending;
}

async function stats(log: string[]) {
  const autos = must(await contentDb().from("content_automations").select("id, stats_at").is("archived_at", null).not("zernio_workflow_id", "is", null), "autos") as any[];
  for (const a of autos) {
    if (a.stats_at && Date.now() - Date.parse(a.stats_at) < STATS_EVERY_MS) continue;
    try {
      const r = await refreshStats(a.id);
      if (r.newEmails) log.push(`stats: ${r.newEmails} new emails`);
    } catch (e) {
      log.push(`stats ${a.id}: ${(e as Error).message}`);
    }
  }
}
