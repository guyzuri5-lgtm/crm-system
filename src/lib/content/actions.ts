import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { randomUUID, createHash } from "node:crypto";
import { contentDb, must, nowIso } from "./db";
import { audit, redact, writesEnabled, WritesDisabled, ZernioError } from "./zernio";

/**
 * מסכי אישור, בצד השרת.
 *
 * כל כתיבה ל-Zernio היא שתי קריאות מהדפדפן:
 *   1. .../plan → השרת בודק, בונה את הבקשות המדויקות, שומר אותן כפעולה ממתינה
 *      ומחזיר תקציר למסך האישור;
 *   2. /api/content/actions/<id>/confirm → מריץ בדיוק את מה שהוצג. לא יותר.
 *
 * תכנית קשורה לטביעה של מה שהוצג; אם הפריט השתנה אחרי שמסך האישור נפתח,
 * האישור נדחה. תכנית פגה אחרי 20 דקות.
 */

const EXPIRY_MS = 20 * 60 * 1000;

export type Plan = Record<string, any>;
type Executor = (plan: Plan, body: Record<string, any>) => Promise<Record<string, any>>;
const executors: Record<string, Executor> = {};

export function executor(kind: string, fn: Executor) {
  executors[kind] = fn;
}

export function fingerprint(...parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export async function createAction(kind: string, itemId: string | null, plan: Plan) {
  const id = randomUUID().replace(/-/g, "");
  let q = contentDb().from("content_pending_actions").update({ status: "superseded" }).eq("kind", kind).eq("status", "pending");
  q = itemId ? q.eq("item_id", itemId) : q.is("item_id", null);
  must(await q, "supersede");
  must(await contentDb().from("content_pending_actions").insert({ id, kind, item_id: itemId, plan, status: "pending" }), "create action");
  return id;
}

/** מה היה עובר ברשת — בלי המפתח, עם שמות הקבצים במקום כתובות שעוד לא קיימות. */
export function dryRunView(plan: Plan) {
  return (plan.steps || []).map((s: any) => ({
    method: s.method,
    path: s.path,
    ...(s.body !== undefined ? { body: JSON.parse(redact(JSON.stringify(s.body))) } : {}),
    ...(s.note ? { note: s.note } : {}),
  }));
}

export async function confirmAction(id: string, body: Record<string, any>) {
  const row = must(await contentDb().from("content_pending_actions").select("*").eq("id", id).maybeSingle(), "action");
  if (!row) return { status: 404, json: { error: "הפעולה לא נמצאה" } };
  if (row.status !== "pending") return { status: 409, json: { error: "הפעולה כבר בוצעה או הוחלפה בפעולה חדשה — פתחו את מסך האישור מחדש" } };
  if (Date.now() - Date.parse(row.created_at) > EXPIRY_MS) {
    await contentDb().from("content_pending_actions").update({ status: "expired" }).eq("id", id);
    return { status: 409, json: { error: "מסך האישור פג תוקף (20 דקות) — פתחו אותו מחדש" } };
  }
  const plan = row.plan as Plan;
  const fn = executors[row.kind];
  if (!fn) return { status: 500, json: { error: `אין מבצע לפעולה ${row.kind}` } };

  if (!plan.localOnly && !(await writesEnabled())) {
    await audit({ actor: "ui", action: `DRY RUN (writes off): ${row.kind}`, item_id: row.item_id, request: dryRunView(plan), ok: false });
    return {
      status: 200,
      json: { dryRun: true, requests: dryRunView(plan), message: "כתיבה ל-Zernio כבויה, אז שום דבר לא נשלח. אלה הבקשות המדויקות שהיו נשלחות." },
    };
  }

  // תופסים את הפעולה: לחיצה כפולה לא מריצה אותה פעמיים
  const claimed = must(
    await contentDb().from("content_pending_actions").update({ status: "running" }).eq("id", id).eq("status", "pending").select("id"),
    "claim action",
  );
  if (!claimed.length) return { status: 409, json: { error: "הפעולה כבר רצה" } };

  let status = "done";
  let result: Record<string, any>;
  try {
    result = await fn(plan, body || {});
  } catch (e) {
    status = "failed";
    if (e instanceof ZernioError) result = { error: e.hebrew, status: e.status };
    else if (e instanceof WritesDisabled) result = { error: "כתיבה ל-Zernio כובתה באמצע הפעולה" };
    else result = { error: redact(`שגיאה: ${(e as Error).message}`) };
  }
  await contentDb().from("content_pending_actions").update({ status, executed_at: nowIso(), result }).eq("id", id);
  return { status: status === "done" ? 200 : 502, json: { ok: status === "done", ...result } };
}
