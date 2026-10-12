import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, getMeta, must, nowIso, setMeta } from "./db";
import { zwrite } from "./zernio";

/**
 * תמונת קאבר לסרטון שהגיע מהתיקייה "מוכן לפרסום".
 *
 * הקאבר נבחר על המחשב של גיא (video-to-gantt/intake.py sync): קובץ cover*.jpg/png
 * או קאבר*.jpg/png שהוא שם בתיקיית הפוסט, ואם אין — הפריים הכי חד מ-2 השניות
 * הראשונות (cover_auto.jpg). השרת לא רואה את התיקייה, ולכן הסנכרון מעלה את
 * הקאבר ל-Zernio כל עוד הפוסט מחכה לאישור, ומחליף אותו כשהבחירה בתיקייה
 * משתנה. "אשר ותזמן" שולח את מה שעלה אחרון.
 *
 * נשמר ב-content_meta ולא ב-content_media: שורת מדיה נספרת כקובץ בפוסט
 * (ריל עם שני קבצים נחסם), וקאבר הוא שדה של הווידאו ולא קובץ נוסף.
 */

const KEY = "intake_covers";

export interface Cover {
  url: string;
  source: "mine" | "auto";
  file: string;
  sig: string;
  size: number;
  uploadedAt: string;
}

type Store = Record<string, { current?: Cover; next?: Omit<Cover, "uploadedAt"> & { mediaKey?: string } }>;

const load = async () => (await getMeta<Store>(KEY)) || {};

export async function allCovers(): Promise<Record<string, Cover>> {
  const s = await load();
  const out: Record<string, Cover> = {};
  for (const [id, c] of Object.entries(s)) if (c.current) out[id] = c.current;
  return out;
}

export async function coverFor(itemId: string): Promise<Cover | null> {
  return (await load())[itemId]?.current || null;
}

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** כתובת העלאה לקאבר. רק לפריט מהתיקייה שעוד לא נשלח ל-Zernio — פוסט מתוזמן לא נוגעים בו. */
export async function presignCover(itemId: string, b: Record<string, any>) {
  const item = must(await contentDb().from("content_items").select("data").eq("id", itemId).is("deleted_at", null).maybeSingle(), "item") as any;
  if (!item?.data?.intake) throw new Error("הפריט לא נמצא או שלא הגיע מהתיקייה");
  const pub = must(await contentDb().from("content_publications").select("status").eq("item_id", itemId).maybeSingle(), "pub") as any;
  if (pub && pub.status !== "cancelled") throw new Error("לפריט כבר יש פוסט ב-Zernio — לא מחליפים לו קאבר");
  const file = String(b.file || "").slice(0, 200);
  const ext = (file.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
  const ct = TYPES[ext];
  if (!ct) throw new Error("קאבר צריך להיות JPG או PNG");
  const size = Number(b.size);
  if (!(size > 0) || size > 10 * 1024 ** 2) throw new Error("קאבר עד 10MB (המגבלה של Zernio)");
  const source = b.source === "mine" ? "mine" : "auto";
  const name = `cover-${itemId.slice(0, 8)}${ext}`;
  const data = await zwrite<any>("POST", "/media/presign", { filename: name, contentType: ct, size },
    { action: "cover upload (temporary, waiting for approval)", itemId, safety: true });
  const s = await load();
  s[itemId] = { ...s[itemId], next: { url: data.publicUrl, source, file, sig: String(b.sig || "").slice(0, 300), size } };
  await setMeta(KEY, s);
  return { uploadUrl: data.uploadUrl as string, contentType: ct };
}

/** ההעלאה הסתיימה: בודקים שהקובץ שם, והוא הופך לקאבר שיישלח באישור. */
export async function coverUploaded(itemId: string) {
  const s = await load();
  const next = s[itemId]?.next;
  if (!next) throw new Error("אין קאבר שמחכה לסיום העלאה");
  let ok = false;
  try {
    const r = await fetch(next.url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    ok = r.ok && Number(r.headers.get("content-length") || next.size) === Number(next.size);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("הקאבר לא נמצא באחסון של Zernio אחרי ההעלאה");
  const current: Cover = { ...next, uploadedAt: nowIso() };
  s[itemId] = { current };
  await setMeta(KEY, s);
  return current;
}
