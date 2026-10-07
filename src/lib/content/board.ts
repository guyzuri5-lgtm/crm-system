import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { contentDb, must, nowIso } from "./db";

/**
 * הלוח: פריטים, סוגים, סטטוסים, ימי העלאה — באותו מבנה שהגאנט תמיד השתמש בו
 * ({items, types, activeWeekdays, statuses, ...}), עכשיו ב-Supabase.
 *
 * שמירה היא של הלוח כולו (המודל של persist() בגאנט), עם מספר גרסה כדי ששני
 * חלונות לא ידרסו זה את זה בשקט. מחיקה רכה. לוח ריק שמגיע מעל לוח מלא נחסם —
 * זו בדיוק הצורה של התאונה שבה הלוח אבד פעם.
 */

/** שדות שהשרת מחזיק ומציג, ושמירה מהדפדפן לעולם לא דורסת */
export const SERVER_KEYS = ["pub", "targets", "automation", "mediaFiles"];

const DEFAULT_TYPES = [
  { id: "edu", name: "חינוכי", color: "#2a78d6" },
  { id: "ent", name: "בידור", color: "#eb6834" },
  { id: "bts", name: "מאחורי הקלעים", color: "#1baf7a" },
  { id: "insp", name: "השראה", color: "#eda100" },
  { id: "pers", name: "אישי", color: "#e87ba4" },
  { id: "promo", name: "מכירתי", color: "#008300" },
];

export class Conflict extends Error {
  constructor(public revision: number) {
    super("conflict");
  }
}
export class Refused extends Error {}

type Board = Record<string, any>;

function cleanItem(it: Record<string, any>) {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(it)) if (!SERVER_KEYS.includes(k)) o[k] = v;
  return o;
}

async function boardRow() {
  return must(await contentDb().from("content_board").select("data, revision").eq("id", true).single(), "board");
}

async function liveItems(): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  // דפדוף: PostgREST מחזיר עד 1000 שורות בבקשה
  for (let from = 0; ; from += 1000) {
    const rows = must(
      await contentDb().from("content_items").select("id, data").is("deleted_at", null).order("id").range(from, from + 999),
      "items",
    );
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadBoard(): Promise<Board> {
  const row = await boardRow();
  const data = (row.data || {}) as Board;
  const items = (await liveItems()).map((r) => r.data);
  const state: Board = {
    ...(data.extra || {}),
    types: Array.isArray(data.types) ? data.types : DEFAULT_TYPES.map((t) => ({ ...t })),
    activeWeekdays: Array.isArray(data.activeWeekdays) && data.activeWeekdays.length === 7 ? data.activeWeekdays : Array(7).fill(true),
    items,
    revision: Number(row.revision) || 0,
  };
  return state;
}

async function protectedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const pubs = must(
    await contentDb().from("content_publications").select("item_id").not("zernio_post_id", "is", null)
      .in("status", ["scheduled", "publishing", "partial", "failed", "unknown"]),
    "protected pubs",
  );
  pubs.forEach((r: any) => ids.add(r.item_id));
  const links = must(await contentDb().from("content_automation_links").select("item_id").is("unlinked_at", null), "protected links");
  links.forEach((r: any) => ids.add(r.item_id));
  return ids;
}

/** מחליף את הלוח ב-payload. מחזיר את הגרסה החדשה ואת מה שלא נמחק כי הוא מוגן. */
export async function saveBoard(payload: Board, opts: { allowEmpty?: boolean } = {}) {
  if (!payload || !Array.isArray(payload.items) || !Array.isArray(payload.types)) throw new Refused("מבנה לא תקין: חסרים items או types");
  const row = await boardRow();
  const rev = Number(row.revision) || 0;
  let sent: number | null = null;
  if (payload.revision !== undefined && payload.revision !== null) {
    sent = Number(payload.revision);
    if (!Number.isFinite(sent)) throw new Refused("revision לא תקין");
    if (sent !== rev) throw new Conflict(rev);
  }

  const incoming = new Map<string, Record<string, any>>();
  for (const it of payload.items) if (it && typeof it === "object" && it.id) incoming.set(String(it.id), cleanItem(it));
  const live = await liveItems();
  if (!incoming.size && live.length > 3 && !opts.allowEmpty)
    throw new Refused(`נשלח לוח ריק מעל ${live.length} פריטים קיימים — השמירה נחסמה כדי לא למחוק הכל.`);

  // תופסים את הגרסה *לפני* שכותבים: שני חלונות שמגיעים יחד — רק אחד עובר
  const extra: Board = {};
  for (const [k, v] of Object.entries(payload)) if (!["items", "types", "activeWeekdays", "revision"].includes(k)) extra[k] = v;
  const claimed = must(
    await contentDb().from("content_board")
      .update({
        revision: rev + 1,
        data: {
          types: payload.types,
          activeWeekdays: Array.isArray(payload.activeWeekdays) && payload.activeWeekdays.length === 7 ? payload.activeWeekdays : Array(7).fill(true),
          extra,
        },
        updated_at: nowIso(),
      })
      .eq("id", true).eq("revision", rev).select("revision"),
    "board claim",
  );
  if (!claimed.length) throw new Conflict(rev);

  const liveMap = new Map(live.map((r) => [String(r.id), JSON.stringify(r.data)]));
  const t = nowIso();
  const changed = [...incoming.entries()]
    .filter(([id, it]) => liveMap.get(id) !== JSON.stringify(it))
    .map(([id, it]) => ({ id, data: it, date: it.date ?? null, updated_at: t, deleted_at: null }));
  try {
    for (let i = 0; i < changed.length; i += 200) {
      must(await contentDb().from("content_items").upsert(changed.slice(i, i + 200)), "items upsert");
    }
  } catch (e) {
    // הגרסה כבר נתפסה; מחזירים אותה, כדי שהדפדפן ינסה שוב עם אותו מספר ולא יקבל 409 ויטען מחדש
    await contentDb().from("content_board").update({ revision: rev }).eq("id", true).eq("revision", rev + 1);
    throw e;
  }

  const kept: string[] = [];
  const prot = await protectedIds();
  const gone = live.map((r) => String(r.id)).filter((id) => !incoming.has(id));
  const toDelete = gone.filter((id) => (prot.has(id) ? (kept.push(id), false) : true));
  if (toDelete.length) {
    must(await contentDb().from("content_items").update({ deleted_at: t }).in("id", toDelete), "items soft delete");
  }
  return { revision: rev + 1, kept };
}

// ── ייבוא ──

/** מקבל: ה-localStorage של הגאנט הישן, קובץ הגיבוי של הגאנט, או {"content-gantt-data-v1": "<json>"} */
export function parseImport(blob: unknown): Board {
  let b: any = typeof blob === "string" ? JSON.parse(blob) : blob;
  if (b && typeof b === "object" && "content-gantt-data-v1" in b) {
    const inner = b["content-gantt-data-v1"];
    b = typeof inner === "string" ? JSON.parse(inner) : inner;
  }
  if (b && typeof b === "object" && b.state && typeof b.state === "object") b = b.state;
  if (!b || typeof b !== "object" || !Array.isArray(b.items)) throw new Refused("הקובץ לא נראה כמו ייצוא של הגאנט (לא נמצאה רשימת items).");
  if (!Array.isArray(b.types)) b.types = [];
  return b;
}
