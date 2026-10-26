import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- שורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getMeta, getSettings, must, nowIso, setMeta } from "./db";
import { writesEnabled, zwrite, ZernioError } from "./zernio";
import { bumpRevision } from "./intake";
import { confirmAction } from "./actions";
import { planSchedule } from "./publishing";
import { getAutomation, planLink, validate as validateAutomation } from "./automations";
import { addDays, AUTO_SWAP_HOURS, DEFAULT_TIME, guardVerdict, HORIZON_DAYS, hoursUntil, localNow, LOCK_HOURS, MIN_LEAD_MINUTES, normalizeRules, planLayout, wantsAutomation, type Movable, type Placed } from "./pure/autoplan";
import { zonedToUtc } from "./pure/platforms";

/**
 * השיבוץ האוטומטי (גיא, 14.10.2026). רץ מעובד הרקע כל 5 דקות, רק כשהמתג
 * "תזמון אוטומטי" דלוק:
 *  1. משבץ סרטונים מהשורה "מוכנים לתזמון" לימים (הכללים ב-pure/autoplan.ts);
 *  2. מתזמן ב-Zernio כל סרטון מהתיקייה שיש לו יום — גם כזה שגיא גרר בעצמו —
 *     חוץ מפוסט שמבקש תגובות ועוד אין לו אוטומציה. אותו פוסט מסומן בכתום
 *     בגאנט, ומתוזמן בריצה שאחרי שגיא בוחר לו אוטומציה. 48 שעות לפני יש התראה
 *     (בגאנט, admin.js); 24 שעות לפני ועדיין אין — הוא חוזר לשורה ומשתבץ מחדש
 *     ליום רחוק יותר, ופוסט מוכן נכנס למשבצת שהתפנתה;
 *  3. אחרי התזמון מקשר את האוטומציה שגיא בחר (לעולם לא בוחר אחת בעצמו).
 *
 * התזמון עובר באותו מסלול כמו "אשר ותזמן" (planSchedule → confirmAction), עם
 * כל הבדיקות שלו; ההבדל היחיד הוא שאין מסך אישור. המתג הראשי של Zernio
 * (writesEnabled) עדיין קובע.
 */

const RETRY_AFTER_MS = 60 * 60_000;
const LIVE_PUB = ["scheduled", "publishing", "published", "partial", "failed", "unknown"];

export interface AutoplanReport {
  at: number;
  placed: { id: string; title: string; date: string; time: string }[];
  scheduled: string[];
  linked: string[];
  /** פוסטים שהוזזו כי לא חוברה להם אוטומציה בזמן — נשמר 24 שעות, להתראה בגאנט */
  moved: { id: string; title: string; from: string; at: number; reason?: string }[];
  /** פריט → הסיבה שלא תוזמן או לא קושר. נשמר בין ריצות כדי לא לנסות שוב כל 5 דקות. */
  /** פוסטים של המערכת שעברו משבצת כי התוכנית השתנתה (ימים, שעות, סרטון חדש) */
  shifted: { id: string; title: string; from: string; to: string }[];
  failures: Record<string, { at: number; text: string }>;
  note?: string;
}

type Alert = (level: "error" | "warn", text: string, itemId?: string | null) => void;

async function liveItems() {
  const out: { id: string; data: any }[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await contentDb().from("content_items").select("id, data").is("deleted_at", null).order("id").range(from, from + 999), "items") as any[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function runAutoplan(alert: Alert, log: string[], deadline: number) {
  const settings = await getSettings();
  if (!settings.autoSchedule) return;
  const prev = (await getMeta<AutoplanReport>("autoplan_last")) || null;
  const report: AutoplanReport = { at: Date.now() / 1000, placed: [], shifted: [], scheduled: [], linked: [], failures: {},
    moved: (prev?.moved || []).filter((m) => Date.now() / 1000 - m.at < 86400) };
  // כישלון מהשעה האחרונה לא מנוסה שוב — אחרת כל ריצה הייתה מציפה את היומן
  for (const [id, f] of Object.entries(prev?.failures || {})) if (Date.now() / 1000 - f.at < RETRY_AFTER_MS / 1000) report.failures[id] = f;

  const tz = settings.timezone;
  const now = localNow(tz);
  const items = await liveItems();
  const pubs = new Map((must(await contentDb().from("content_publications").select("item_id, status, zernio_post_id, updated_at"), "pubs") as any[]).map((p) => [p.item_id, p]));
  const media = new Set((must(await contentDb().from("content_media").select("item_id").eq("status", "ready").is("deleted_at", null), "media") as any[]).map((m) => m.item_id));
  const links = new Map<string, string>();
  for (const l of must(await contentDb().from("content_automation_links").select("item_id, automation_id").is("unlinked_at", null), "links") as any[]) links.set(l.item_id, l.automation_id);

  const hasPost = (id: string) => {
    const p = pubs.get(id);
    return Boolean(p && LIVE_PUB.includes(p.status) && (p.zernio_post_id || p.status === "unknown"));
  };
  // פוסט שגיא ביטל ב-Zernio נשאר ביומו ולא מתוזמן מחדש מעצמו. אם הוא החזיר אותו
  // לשורה "מוכנים לתזמון" והשיבוץ שם אותו שוב — זה כבר שיבוץ חדש, ומתזמנים.
  const cancelledByGuy = (r: { id: string; data: any }) => {
    const p = pubs.get(r.id);
    return p?.status === "cancelled" && !(r.data.autoplan?.at && Date.parse(r.data.autoplan.at) > Date.parse(p.updated_at));
  };

  const automated = (r: { id: string; data: any }) => Boolean(r.data.automationChoice) || links.has(r.id);
  const needsAuto = (r: { id: string; data: any }) => wantsAutomation(r.data) && !automated(r);

  // ── 0. פוסט בלי אוטומציה, 24 שעות לפני: חוזר לשורה, והשיבוץ ימלא את המשבצת ──
  const toMove = items.filter((r) => r.data.intake && r.data.date && !hasPost(r.id) && !cancelledByGuy(r) && needsAuto(r)
    && hoursUntil(r.data.date, r.data.time, now) < AUTO_SWAP_HOURS);
  if (toMove.length) {
    await bumpRevision();
    const t = nowIso();
    for (const r of toMove) {
      const from = `${r.data.date} ${r.data.time || ""}`.trim();
      const data = { ...r.data, date: null, autoplan: { ...(r.data.autoplan || {}), movedAt: t, movedFrom: from } };
      const done = must(await contentDb().from("content_items").update({ data, date: null, updated_at: t })
        .eq("id", r.id).eq("date", r.data.date).is("deleted_at", null).select("id"), "autoplan move") as any[];
      if (!done.length) continue;
      r.data = data;
      report.moved.push({ id: r.id, title: data.title, from, at: Date.now() / 1000 });
      alert("warn", `'${data.title}' הוזז מ-${from}: לא חוברה לו אוטומציה 24 שעות לפני.`, r.id);
    }
    log.push(`autoplan: moved ${toMove.length} without automation`);
  }

  // ── 1. שיבוץ, והזזה של מה שהמערכת שיבצה ──
  // יום תפוס = פוסט אמיתי: סרטון מהתיקייה, פוסט שכבר ב-Zernio, או פריט שהועלה לו קובץ.
  // רעיון בלוח בלי קובץ (פוסט "לצלם את X") לא תופס משבצת.
  const rules = normalizeRules({ days: settings.autoplanDays, times: settings.autoplanTimes });
  const writesOn = await writesEnabled();
  const slotOf = (d: any) => `${d.date} ${d.time || DEFAULT_TIME}`;
  // פוסט של המערכת = היא שיבצה אותו ואף אחד לא הזיז אותו מאז. גרירה של גיא משנה
  // את היום או השעה, ומאותו רגע הפוסט שלו. שיבוץ מלפני 26.10 נשמר בלי slot.
  const ours = (r: { data: any }) => Boolean(r.data.autoplan?.at) && (!r.data.autoplan.slot || r.data.autoplan.slot === slotOf(r.data));
  const inZernio = (id: string) => {
    const p = pubs.get(id);
    return Boolean(p && p.status === "scheduled" && p.zernio_post_id);
  };
  const canMove = (r: { id: string; data: any }) => {
    const d = r.data;
    if (!d.intake || !d.date || d.format === "story" || !ours(r) || cancelledByGuy(r) || !media.has(r.id)) return false;
    if (report.failures[`move:${r.id}`] || hoursUntil(d.date, d.time, now) < LOCK_HOURS) return false;
    // פוסט שכבר ב-Zernio זז רק כשאפשר לעדכן אותו שם — אחרת הלוח וה-Zernio היו נפרדים
    if (inZernio(r.id)) return writesOn;
    return !hasPost(r.id);
  };
  const from = addDays(now.date, -HORIZON_DAYS);
  const fixed: Placed[] = [];
  const movable: Movable[] = [];
  for (const r of items) {
    const d = r.data;
    if (!d.date || d.date < from || d.format === "story" || !(d.intake || hasPost(r.id) || media.has(r.id))) continue;
    const auto = automated(r) || wantsAutomation(d);
    if (canMove(r)) movable.push({ id: r.id, date: d.date, time: d.time, topic: d.topic, createdAt: d.createdAt, auto, needsAuto: needsAuto(r) });
    else fixed.push({ id: r.id, date: d.date, time: d.time, topic: d.topic, auto });
  }
  const pool = items
    .filter((r) => r.data.intake && !r.data.date && media.has(r.id) && !hasPost(r.id))
    .map((r) => ({ id: r.id, topic: r.data.topic, createdAt: r.data.createdAt,
      auto: automated(r) || wantsAutomation(r.data), needsAuto: needsAuto(r) }));
  const layout = planLayout(fixed, movable, pool, now, rules);
  if (layout.place.length || layout.move.length) {
    // קודם הגרסה עולה: חלון גאנט פתוח יקבל 409 ויטען מחדש, ולא ידרוס את השיבוץ (כמו ב-intake.ts)
    await bumpRevision();
    const t = nowIso();
    for (const a of layout.place) {
      const row = items.find((r) => r.id === a.id)!;
      const data = { ...row.data, date: a.date, time: a.time, autoplan: { at: t, slot: `${a.date} ${a.time}` } };
      // רק אם הוא עדיין בלי תאריך — אם גיא גרר אותו בינתיים, ההחלטה שלו קובעת
      const done = must(await contentDb().from("content_items").update({ data, date: a.date, updated_at: t })
        .eq("id", a.id).is("date", null).is("deleted_at", null).select("id"), "autoplan place") as any[];
      if (!done.length) continue;
      row.data = data;
      report.placed.push({ id: a.id, title: data.title, date: a.date, time: a.time });
    }
    if (report.placed.length) log.push(`autoplan: placed ${report.placed.length}`);

    for (const m of layout.move.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))) {
      if (Date.now() > deadline) break;   // השאר בריצה הבאה — התוכנית תצא אותו דבר
      const row = items.find((r) => r.id === m.id)!;
      const before = row.data;
      const was = `${m.from.date} ${m.from.time}`;
      const data = { ...before, date: m.date, time: m.time, autoplan: { ...before.autoplan, slot: `${m.date} ${m.time}`, movedAt: t } };
      // רק אם הוא עדיין ביום שלו — אם גיא גרר אותו בינתיים, ההחלטה שלו קובעת
      const done = must(await contentDb().from("content_items").update({ data, date: m.date, updated_at: t })
        .eq("id", m.id).eq("date", m.from.date).is("deleted_at", null).select("id"), "autoplan shift") as any[];
      if (!done.length) continue;
      row.data = data;
      if (inZernio(m.id)) {
        const res = await sendToZernio(m.id, "update");
        if (res.error) {
          // Zernio לא עודכן: הלוח חוזר לשעה שבה הפוסט באמת מתוזמן
          must(await contentDb().from("content_items").update({ data: before, date: before.date, updated_at: nowIso() }).eq("id", m.id), "autoplan shift back");
          row.data = before;
          const text = `'${before.title}' לא הוזז מ-${was}: ${res.error}`;
          report.failures[`move:${m.id}`] = { at: Date.now() / 1000, text };
          alert("error", text, m.id);
          continue;
        }
      }
      report.shifted.push({ id: m.id, title: data.title, from: was, to: `${m.date} ${m.time}` });
    }
    if (report.shifted.length) log.push(`autoplan: shifted ${report.shifted.length}`);
  }

  // ── 2. תזמון ──
  const last = addDays(now.date, Math.max(HORIZON_DAYS, rules.days));
  const nowMs = Date.now();
  const due = items.filter((r) => {
    const d = r.data;
    if (!d.intake || !d.date || d.date > last || hasPost(r.id) || cancelledByGuy(r) || !media.has(r.id)) return false;
    const when = zonedToUtc(`${d.date}T${d.time || "18:00"}`, tz);
    return Boolean(when && when.getTime() - nowMs > (MIN_LEAD_MINUTES / 3) * 60_000);
  }).sort((a, b) => `${a.data.date}T${a.data.time}`.localeCompare(`${b.data.date}T${b.data.time}`));

  const awaiting = due.filter(needsAuto);
  const ready = due.filter((r) => !awaiting.includes(r));
  if (ready.length && !writesOn) {
    report.note = "כתיבה ל-Zernio כבויה, ולכן שום פוסט לא תוזמן. מדליקים אותה במסך 'חיבור ל-Zernio'.";
    alert("error", `תזמון אוטומטי דלוק, אבל כתיבה ל-Zernio כבויה — ${ready.length} פוסטים מחכים לתזמון.`);
  } else {
    for (const r of ready) {
      if (Date.now() > deadline) break;
      if (report.failures[r.id]) continue;
      // האוטומציה שנבחרה חייבת להיות תקינה לפני שהפוסט נשלח — אחרת הוא היה עולה בלעדיה
      if (r.data.automationChoice && !links.has(r.id)) {
        const bad = await automationProblem(r.data.automationChoice, r.id);
        if (bad) {
          const text = `'${r.data.title}' לא תוזמן: ${bad}`;
          report.failures[r.id] = { at: Date.now() / 1000, text };
          alert("error", text, r.id);
          continue;
        }
      }
      const res = await sendToZernio(r.id, "create");
      if (res.dryRun) { report.note = "כתיבה ל-Zernio כבויה."; break; }
      if (res.error) {
        const text = `'${r.data.title}' לא תוזמן: ${res.error}`;
        report.failures[r.id] = { at: Date.now() / 1000, text };
        alert("error", text, r.id);
        continue;
      }
      report.scheduled.push(r.id);
      log.push(`autoplan: scheduled ${r.id.slice(0, 8)} for ${r.data.date} ${r.data.time}`);
    }
  }

  // ── 3. קישור האוטומציה שגיא בחר, אחרי שהפוסט מתוזמן ──
  const freshPubs = new Map((must(await contentDb().from("content_publications").select("item_id, status"), "pubs") as any[]).map((p) => [p.item_id, p.status]));
  for (const r of items) {
    const choice = r.data.automationChoice;
    if (!r.data.intake || !choice || links.has(r.id) || freshPubs.get(r.id) !== "scheduled") continue;
    if (Date.now() > deadline) break;
    const key = `link:${r.id}`;
    if (report.failures[key]) continue;
    const res = await planLink(choice, r.id);
    const j: any = res.json;
    let err: string | null = null;
    if (res.status !== 200 || j.blocked || !j.actionId) err = j.error || (j.validation?.errors || []).join(" · ") || "הבדיקה נכשלה";
    else {
      const c: any = (await confirmAction(j.actionId, {})).json;
      if (!c.ok && !c.dryRun) err = c.error || "שגיאה מ-Zernio";
    }
    if (err) {
      // הפוסט כבר מתוזמן ובלי אוטומציה — מושכים אותו בחזרה עכשיו, לא מחכים לשומר
      await pullBack(r.id, `האוטומציה לא קושרה (${err})`, alert, log, report);
      continue;
    }
    report.linked.push(r.id);
    log.push(`autoplan: linked automation to ${r.id.slice(0, 8)}`);
  }

  await setMeta("autoplan_last", report);
}

/**
 * תזמון חדש או עדכון שעה ב-Zernio, באותו מסלול כמו "אשר ותזמן" (planSchedule →
 * confirmAction) עם כל הבדיקות שלו, בלי מסך אישור. error = למה לא, בעברית.
 */
async function sendToZernio(itemId: string, mode: "create" | "update"): Promise<{ error?: string; dryRun?: boolean }> {
  const res = await planSchedule(itemId, mode);
  const j: any = res.json;
  if (res.status !== 200 || j.blocked || !j.actionId) {
    const errs = j.error ? [j.error] : Object.values(j.validation || {}).flatMap((v: any) => v?.errors || []);
    return { error: errs.slice(0, 2).join(" · ") || "הבדיקה נכשלה" };
  }
  // ההסכמה של טיקטוק: גיא הדליק את התזמון האוטומטי, וזו ההסכמה שלו לכל פוסט שהוא מתזמן
  const c: any = (await confirmAction(j.actionId, { tiktokConsent: true })).json;
  if (c.dryRun) return { dryRun: true };
  if (!c.ok) return { error: c.error || "שגיאה מ-Zernio" };
  return {};
}

/** למה האוטומציה שנבחרה לא תעבוד (או null אם היא תקינה) */
async function automationProblem(automationId: string, itemId: string): Promise<string | null> {
  try {
    const a = await getAutomation(automationId);
    if (a.archived_at) return `האוטומציה '${a.name}' נמחקה מהבנק — בחר אחרת`;
    if (a.status === "paused") return `האוטומציה '${a.name}' מושהית — חדש אותה או בחר אחרת`;
    const v = await validateAutomation(automationId, [itemId]);
    if (v.errors.length) return `האוטומציה '${a.name}' לא עוברת בדיקה: ${v.errors[0]}`;
    return null;
  } catch (e) {
    return `האוטומציה שנבחרה לא נמצאה (${(e as Error).message})`;
  }
}

// ── השומר: אף פוסט שמבקש אוטומציה לא עולה בלעדיה ──

/**
 * רץ בכל ריצה של העובד (כל דקה), בלי קשר למתג התזמון האוטומטי: גם פוסט
 * שתוזמן ידנית מוגן. פוסט מתוזמן שמבקש אוטומציה —
 *  - בלי קישור פעיל 15 דקות אחרי שתוזמן (החיבור נכשל, נסגר המסך, נותק) — מבוטל;
 *  - עם קישור שהאוטומציה שלו עוד לא נוצרה 90 שניות לפני הפרסום — מבוטל.
 * ביטול כאן הוא פעולת הגנה, ולכן הוא רץ גם כשכתיבה ל-Zernio כבויה.
 */
export async function guardAutomations(alert: Alert, log: string[]) {
  const pubs = must(await contentDb().from("content_publications").select("item_id, zernio_post_id, scheduled_for, sent_payload")
    .eq("status", "scheduled").not("zernio_post_id", "is", null), "guard pubs") as any[];
  if (!pubs.length) return;
  const ids = pubs.map((p) => p.item_id);
  const rows = must(await contentDb().from("content_items").select("id, data").in("id", ids).is("deleted_at", null), "guard items") as any[];
  const links = must(await contentDb().from("content_automation_links").select("item_id, status, zernio_automation_id")
    .in("item_id", ids).is("unlinked_at", null), "guard links") as any[];
  const { timezone } = await getSettings();
  for (const p of pubs) {
    const row = rows.find((r) => r.id === p.item_id);
    if (!row || !wantsAutomation(row.data)) continue;
    const mine = links.filter((l) => l.item_id === p.item_id);
    const created = mine.some((l) => l.zernio_automation_id && ["live", "creating"].includes(l.status));
    const pending = mine.some((l) => ["armed", "creating"].includes(l.status));
    const at = zonedToUtc(String(p.scheduled_for || ""), timezone);
    if (!at) continue;
    const reason = guardVerdict({
      wants: true, created, pending, publishAt: at.getTime(), now: Date.now(),
      // פוסט שתוזמן לפני שהשומר קיים — בלי חותמת זמן, והחסד שלו כבר עבר
      sentAt: Date.parse(p.sent_payload?._scheduledAt || "") || 0,
    });
    if (reason) await pullBack(p.item_id, reason, alert, log);
  }
}

/**
 * מבטל את הפוסט ב-Zernio, מנתק קישורים שלא נוצרו, ומחזיר סרטון מהתיקייה
 * לשורה "מוכנים לתזמון" — בלי האוטומציה שנבחרה, כדי שלא ייכנס ללולאה של
 * תזמון-כישלון-ביטול. מעכשיו הוא "חסרה אוטומציה" עד שגיא בוחר שוב.
 */
async function pullBack(itemId: string, reason: string, alert: Alert, log: string[], into?: AutoplanReport) {
  const pub = must(await contentDb().from("content_publications").select("zernio_post_id, status").eq("item_id", itemId).maybeSingle(), "pub") as any;
  const item = must(await contentDb().from("content_items").select("data").eq("id", itemId).maybeSingle(), "item") as any;
  const title = item?.data?.title || itemId;
  if (pub?.zernio_post_id && pub.status === "scheduled") {
    try {
      await zwrite("DELETE", `/posts/${pub.zernio_post_id}`, undefined,
        { actor: "worker", action: "guard: cancel post without automation", itemId, safety: true });
    } catch (e) {
      if (!(e instanceof ZernioError && e.status === 404)) {
        alert("error", `'${title}' עומד לעלות בלי אוטומציה (${reason}), והביטול ב-Zernio נכשל: ${e instanceof ZernioError ? e.hebrew : (e as Error).message}. מנסה שוב בדקה הבאה — אפשר גם למחוק אותו ידנית ב-Zernio.`, itemId);
        return;
      }
    }
    const t = nowIso();
    await contentDb().from("content_publications").update({ status: "cancelled", last_synced_at: t, updated_at: t,
      last_error: `בוטל אוטומטית: ${reason}` }).eq("item_id", itemId);
    await contentDb().from("content_targets").update({ status: "cancelled", updated_at: t }).eq("item_id", itemId);
  }
  // קישור שלא התחיל ליצור כלום ב-Zernio — מנותק. 'creating' נשאר: ייתכן שהאוטומציה
  // כן נוצרה שם, ו-sweepOrphans של העובד צריך למצוא אותה ולהשהות אותה
  await contentDb().from("content_automation_links").update({ status: "unlinked", unlinked_at: nowIso(), last_error: reason })
    .eq("item_id", itemId).is("unlinked_at", null).is("zernio_automation_id", null).in("status", ["armed", "error"]);
  if (item?.data?.intake) {
    await bumpRevision();
    const data = { ...item.data, date: null, autoplan: { ...(item.data.autoplan || {}), pulledAt: nowIso(), pulledReason: reason } };
    delete data.automationChoice;
    must(await contentDb().from("content_items").update({ data, date: null, updated_at: nowIso() }).eq("id", itemId), "pull back");
  }
  alert("error", `'${title}' בוטל ב-Zernio ולא יעלה: ${reason}.${item?.data?.intake ? " הוא חזר לשורה \"מוכנים לתזמון\" — בחר לו אוטומציה, והוא ישובץ מחדש." : ""}`, itemId);
  log.push(`guard: pulled back ${itemId.slice(0, 8)}`);
  // ההתראה של העובד מתחלפת כל דקה; הרשימה הזו נשמרת 24 שעות ומוצגת בגאנט
  const entry = { id: itemId, title, from: item?.data?.date ? `${item.data.date} ${item.data.time || ""}`.trim() : "", at: Date.now() / 1000, reason };
  if (into) { into.moved.push(entry); return; }
  const report = (await getMeta<AutoplanReport>("autoplan_last")) ||
    { at: Date.now() / 1000, placed: [], shifted: [], scheduled: [], linked: [], failures: {}, moved: [] };
  report.moved = [...(report.moved || []), entry];
  await setMeta("autoplan_last", report);
}
