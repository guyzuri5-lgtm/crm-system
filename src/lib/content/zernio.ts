import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getSettings } from "./db";

/**
 * הלקוח של Zernio — המקום היחיד שמחזיק את המפתח (ZERNIO_API_KEY במשתני
 * הסביבה של Vercel).
 *
 * מה שנאכף כאן, לא רק מתועד:
 *  - המפתח לא חוזר מאף פונקציה, לא נרשם ליומן ולא נשלח לדפדפן — כל מה שנכתב
 *    עובר דרך redact();
 *  - GET חופשי. יצירה/שינוי/מחיקה רק דרך write(), שמסרב כשהמתג הראשי כבוי,
 *    ונרשמת ב-content_audit_log בכל מקרה.
 */

export const BASE = "https://zernio.com/api/v1";

export function apiKey(): string {
  const k = (process.env.ZERNIO_API_KEY || process.env.LATE_API_KEY || "").trim();
  if (!k) throw new Error("ZERNIO_API_KEY חסר במשתני הסביבה של הפרויקט");
  return k;
}

export function hasKey() {
  return Boolean((process.env.ZERNIO_API_KEY || process.env.LATE_API_KEY || "").trim());
}

export function redact(text: string): string {
  const k = (process.env.ZERNIO_API_KEY || process.env.LATE_API_KEY || "").trim();
  return k && text ? text.split(k).join("<KEY>") : text;
}

export class ZernioError extends Error {
  constructor(public status: number, public data: unknown, what = "") {
    super(`${what} [${status}]: ${redact(JSON.stringify(data)).slice(0, 400)}`);
  }
  get hebrew() {
    return redact(humanize(this.status, this.data));
  }
}

/** ניסיון כתיבה כשהמתג כבוי. נושא את הבקשה, כדי שהמסך יראה מה *היה* נשלח. */
export class WritesDisabled extends Error {
  body: unknown;
  constructor(public method: string, public path: string, body: unknown) {
    super("writes are disabled");
    this.body = body === undefined ? undefined : JSON.parse(redact(JSON.stringify(body)));
  }
}

async function request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(extraHeaders || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const raw = await res.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw.slice(0, 500) };
    }
    return { status: res.status, data };
  } catch (e) {
    // נפילת רשת, timeout, חיבור שנותק — לא נזרק החוצה כחריגה גולמית
    return { status: 0, data: { error: `network: ${(e as Error).message}` } };
  }
}

export async function zget<T = any>(path: string, params?: Record<string, string | number | undefined>, what?: string): Promise<T> {
  let p = path;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    p += (p.includes("?") ? "&" : "?") + q.toString();
  }
  const { status, data } = await request("GET", p);
  if (status === 0 || status >= 300) throw new ZernioError(status, data, what || `GET ${path}`);
  return data as T;
}

/** POST שלא יוצר כלום: /tools/validate/post לפי התיעוד אינו שומר ואינו נוגע בחשבונות. */
export async function zvalidate(body: unknown) {
  return request("POST", "/tools/validate/post", body);
}

export async function writesEnabled() {
  return (await getSettings()).writesEnabled;
}

export async function audit(row: {
  actor: string;
  action: string;
  item_id?: string | null;
  method?: string;
  path?: string;
  request?: unknown;
  status_code?: number;
  ok?: boolean;
  response?: unknown;
}) {
  await contentDb()
    .from("content_audit_log")
    .insert({
      actor: row.actor,
      action: row.action,
      item_id: row.item_id ?? null,
      method: row.method ?? null,
      path: row.path ?? null,
      request: row.request === undefined ? null : redact(JSON.stringify(row.request)).slice(0, 20000),
      status_code: row.status_code ?? null,
      ok: row.ok ?? null,
      response: row.response === undefined ? null : redact(JSON.stringify(row.response)).slice(0, 20000),
    });
}

export interface WriteOpts {
  actor?: string;
  action?: string;
  itemId?: string | null;
  /**
   * רק לפעולות ההגנה של העובד על אוטומציה שכבר אושרה וכבר חיה ב-Zernio:
   * השהיה, או צמצום לפוסט. הן חייבות לרוץ גם כשהמתג כבוי — המתג נועד לעצור
   * דברים חדשים, לא להשאיר אוטומציה פתוחה לכל החשבון.
   */
  safety?: boolean;
  headers?: Record<string, string>;
}

/** כל יצירה/שינוי/מחיקה ב-Zernio. עם שער ועם יומן. */
export async function zwrite<T = any>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, o: WriteOpts = {}): Promise<T> {
  const actor = o.actor || "ui";
  if (!o.safety && !(await writesEnabled())) {
    await audit({ actor, action: `BLOCKED (writes off): ${o.action || ""}`, item_id: o.itemId, method, path, request: body, status_code: -1, ok: false });
    throw new WritesDisabled(method, path, body);
  }
  const { status, data } = await request(method, path, body, o.headers);
  await audit({ actor, action: o.action || `${method} ${path}`, item_id: o.itemId, method, path, request: body, status_code: status, ok: status > 0 && status < 300, response: data });
  if (status === 0 || status >= 300) throw new ZernioError(status, data, o.action || `${method} ${path}`);
  return data as T;
}

// ── שגיאות בעברית ──

function msgOf(data: any): string {
  if (data && typeof data === "object") {
    for (const k of ["message", "error", "details", "reason"]) {
      const v = data[k];
      if (typeof v === "string" && v) return v;
      if (v && typeof v === "object") {
        const m = msgOf(v);
        if (m) return m;
      }
    }
  }
  return data ? JSON.stringify(data).slice(0, 200) : "";
}

export function humanize(status: number, data: unknown): string {
  const raw = msgOf(data);
  const low = raw.toLowerCase();
  if (status === 0) return "אין חיבור ל-Zernio (בעיית רשת). נסו שוב בעוד רגע.";
  if (status === 401) return "Zernio דחה את המפתח. ייתכן שהמפתח בוטל או הוחלף — צריך לעדכן את ZERNIO_API_KEY ב-Vercel.";
  if (status === 403) return "אין הרשאה לפעולה הזאת בחשבון Zernio (ייתכן שהחשבון התנתק, או שהתוכנית לא כוללת אותה).";
  if (status === 404) return "Zernio לא מצא את הפריט — ייתכן שנמחק ישירות ב-Zernio.";
  if (status === 409 || low.includes("duplicate") || low.includes("already scheduled"))
    return "Zernio חסם את זה כתוכן כפול — כבר קיים פוסט עם אותו תוכן לאותו חשבון ב-24 השעות האחרונות. שנו את הכיתוב או את המדיה.";
  if (status === 429) return "יותר מדי בקשות ל-Zernio, או מכסת הפרסום של החשבון נגמרה. המתינו ונסו שוב.";
  if (low.includes("reconnect") || (low.includes("token") && (low.includes("expire") || low.includes("invalid"))))
    return "החשבון ברשת הזאת התנתק מ-Zernio. צריך לחבר אותו מחדש באתר של Zernio.";
  if (["media", "video", "image", "aspect", "duration"].some((w) => low.includes(w))) return `בעיה במדיה: ${raw}`;
  if (status >= 500) return `שגיאה בצד של Zernio (${status}). נסו שוב מאוחר יותר. (${raw})`;
  return `Zernio החזיר שגיאה (${status}): ${raw}`;
}
