import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- שורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { contentDb, getMeta, must, nowIso, releaseLease, setMeta, tryLease } from "./db";
import { loadBoard } from "./board";
import { markUploaded, mediaPublic, mediaRows, presignMedia } from "./publishing";
import { PLATFORMS } from "./pure/platforms";

/**
 * כניסה של סרטון ערוך מהמחשב של גיא אל הגאנט (הסקיל video-to-gantt).
 *
 * הסקיל רץ על המחשב ולא בדפדפן, ולכן אין לו עוגיית התחברות. הוא מזדהה
 * בטוקן משלו, שרק ה-hash שלו שמור כאן (content_meta.intake_token_hash) —
 * אין משתנה סביבה חדש ב-Vercel, ומי שקורא את המסד לא מקבל את הטוקן.
 *
 * מה הטוקן מאפשר: לקרוא את הגדרות הלוח, ליצור פריט "ממתין לאישור" ולהעלות
 * לו קובץ זמני ל-Zernio. הוא לא יכול לתזמן, לשנות או למחוק שום דבר ב-Zernio
 * — זה נשאר במסך האישור בגאנט, מאחורי התחברות.
 *
 * הקובץ עולה ישר מהמחשב לאחסון של Zernio, כמו העלאה מהדפדפן. Zernio מוחק
 * העלאה כזו אחרי 7 ימים אם אף פוסט לא מפנה אליה, ולכן הסקיל מעלה מחדש
 * (replaceMedia) כל עוד הפריט מחכה לאישור והקובץ עוד בתיקייה.
 */

const TOKEN_KEY = "intake_token_hash";
const sha = (s: string) => createHash("sha256").update(s).digest();

export async function checkIntakeToken(header: string | null): Promise<boolean> {
  const token = (header || "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 32) return false;
  const stored = await getMeta<string>(TOKEN_KEY);
  if (!stored) return false;
  const a = sha(token);
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** מנפיק טוקן חדש (הקודם מפסיק לעבוד). מחזיר אותו פעם אחת בלבד. */
export async function issueIntakeToken() {
  const token = randomBytes(32).toString("hex");
  await setMeta(TOKEN_KEY, sha(token).toString("hex"));
  return token;
}

// ── הקשר לסקיל: סוגים, ימי העלאה, דוגמאות קול ──

export async function intakeContext() {
  const board = await loadBoard();
  const ig = must(await contentDb().from("content_ig_imports").select("data").eq("id", "main").maybeSingle(), "ig") as any;
  const posts: any[] = Array.isArray(ig?.data?.posts) ? ig.data.posts : [];
  // הכיתובים האמיתיים מאינסטגרם — הכי חדשים קודם, רק כאלה שיש בהם משהו לקרוא
  const voice = posts
    .filter((p) => typeof p.caption === "string" && p.caption.trim().length > 80)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 12)
    .map((p) => ({ date: p.date, views: p.views ?? null, caption: String(p.caption).slice(0, 2200) }));
  const autos = must(await contentDb().from("content_automations").select("name, keyword, status").is("archived_at", null), "automations") as any[];
  return {
    types: (board.types || []).map((t: any) => ({ id: t.id, name: t.name, weeklyTarget: Number(t.weeklyTarget) || 0 })),
    activeWeekdays: board.activeWeekdays,
    voice,
    automationKeywords: autos.filter((a) => a.keyword).map((a) => ({ name: a.name, keyword: a.keyword, status: a.status })),
  };
}

// ── יצירת פריט ──

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function findBySource(sourceKey: string) {
  return must(
    await contentDb().from("content_items").select("id, data").is("deleted_at", null).eq("data->intake->>sourceKey", sourceKey).maybeSingle(),
    "intake dedup",
  ) as any;
}

/** תגיות יוטיוב: בלי #, בלי פסיקים בתוך תגית, בלי כפילויות, ועד 500 תווים ביחד (המגבלה של יוטיוב) */
function youtubeTags(v: unknown): string {
  const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : [])
    .map((t) => String(t).replace(/^#/, "").replace(/[,<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60))
    .filter(Boolean);
  const out: string[] = [];
  let len = 0;
  for (const t of list) {
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    // תגית עם רווח נספרת ביוטיוב עם המירכאות סביבה
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (len + cost > 480) break;
    out.push(t);
    len += cost;
  }
  return out.join(", ");
}

async function bumpRevision() {
  for (let i = 0; i < 8; i++) {
    const row = must(await contentDb().from("content_board").select("revision").eq("id", true).single(), "board") as any;
    const rev = Number(row.revision) || 0;
    const done = must(await contentDb().from("content_board").update({ revision: rev + 1, updated_at: nowIso() })
      .eq("id", true).eq("revision", rev).select("revision"), "bump revision") as any[];
    if (done.length) return rev + 1;
  }
  throw new Error("הלוח נשמר שוב ושוב ברגע זה — נסו שוב");
}

async function withLease<T>(fn: () => Promise<T>): Promise<T> {
  // כמה קבצים בבת אחת: כל אחד רואה את השיבוץ של הקודם, ולכן מקבל יום אחר
  for (let i = 0; i < 40 && !(await tryLease("intake", 60)); i++) await new Promise((r) => setTimeout(r, 500));
  try {
    return await fn();
  } finally {
    await releaseLease("intake");
  }
}

export async function createIntakeItem(b: Record<string, any>) {
  const sourceKey = str(b.sourceKey, 300);
  const filename = str(b.filename, 200);
  const title = str(b.title, 120);
  if (!sourceKey || !filename || !title) throw new Error("חסר sourceKey, filename או title");
  const size = Number(b.size);
  if (!(size > 0)) throw new Error("גודל קובץ לא תקין");

  // הפריט נכנס בלי תאריך: הוא מחכה בשורה "מוכנים לתזמון" בראש הגאנט, וגיא
  // גורר אותו ליום. המנעול רק מונע שני פריטים לאותו קובץ כשהוא נשלח פעמיים.
  return withLease(async () => {
    const existing = await findBySource(sourceKey);
    if (existing) {
      return { duplicate: true, itemId: existing.id, date: existing.data.date, title: existing.data.title,
        media: (await mediaRows(existing.id)).map(mediaPublic) };
    }

    const board = await loadBoard();
    const typeId = (board.types || []).some((t: any) => t.id === b.typeId) ? String(b.typeId) : null;

    const id = randomUUID();
    const keyword = str(b.keyword, 40);
    const platforms = Array.isArray(b.platforms) ? b.platforms.filter((p: string) => (PLATFORMS as readonly string[]).includes(p)) : [...PLATFORMS];
    const ytTitle = (str(b.youtubeTitle, 100) || title).slice(0, 100);
    const ytTags = youtubeTags(b.youtubeTags);
    const item: Record<string, any> = {
      id, date: null, time: /^\d{2}:\d{2}$/.test(String(b.time)) ? b.time : "18:00",
      title, caption: str(b.caption, 2200), format: "reel", typeId,
      note: str(b.note, 4000),
      filmed: true, edited: true, scheduled: false,
      statusFlags: { filmed: true, edited: true, scheduled: false },
      platforms,
      platformOptions: {
        youtube: { title: ytTitle, visibility: "public", categoryId: "22", ...(ytTags ? { tags: ytTags } : {}) },
        tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true },
        instagram: { shareToFeed: true },
      },
      createdAt: Date.now(),
      intake: {
        source: "folder", sourceKey, file: filename, at: nowIso(), ...(keyword ? { keyword } : {}),
      },
    };

    // קודם מספר הגרסה של הלוח עולה, ורק אז הפריט נכנס: חלון גאנט פתוח
    // שישמור את הלוח הישן יקבל 409 ויטען מחדש, במקום למחוק את הפריט הזה.
    // בסדר ההפוך, שמירה שקראה את הפריטים בין שני הצעדים הייתה מוחקת אותו.
    await bumpRevision();
    must(await contentDb().from("content_items").insert({ id, data: item, date: item.date, updated_at: nowIso() }), "intake insert");

    const upload = await presignMedia(id, { filename, size, contentType: str(b.contentType, 60), meta: b.meta });
    return { duplicate: false, itemId: id, date: null, time: item.time, title, upload };
  });
}

export async function intakeUploaded(mediaId: string, replace: boolean) {
  const media = await markUploaded(mediaId);
  if (!replace) return media;
  // העלאה מחדש: הקובץ הישן ב-Zernio עומד לפוג, והחדש מחליף אותו
  const m = must(await contentDb().from("content_media").select("item_id").eq("id", mediaId).maybeSingle(), "media") as any;
  must(await contentDb().from("content_media").update({ deleted_at: nowIso() }).eq("item_id", m.item_id).neq("id", mediaId).is("deleted_at", null), "media replace");
  return (await mediaRows(m.item_id)).map(mediaPublic);
}

export async function replaceMedia(itemId: string, b: Record<string, any>) {
  const item = must(await contentDb().from("content_items").select("data").eq("id", itemId).is("deleted_at", null).maybeSingle(), "item") as any;
  if (!item?.data?.intake) throw new Error("הפריט לא נמצא או שלא הגיע מהתיקייה");
  const pub = must(await contentDb().from("content_publications").select("status").eq("item_id", itemId).maybeSingle(), "pub") as any;
  if (pub && pub.status !== "cancelled") throw new Error("לפריט כבר יש פוסט ב-Zernio — לא מחליפים לו קובץ");
  return presignMedia(itemId, { filename: str(b.filename, 200), size: Number(b.size), contentType: str(b.contentType, 60), meta: b.meta });
}

/** מה קרה לכל סרטון שנכנס מהתיקייה — לסקריפט שמעביר קבצים ל"תוזמן" ומרענן העלאות. */
export async function intakeStatus() {
  const rows = must(
    await contentDb().from("content_items").select("id, data, deleted_at").not("data->intake", "is", null),
    "intake items",
  ) as any[];
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const pubs = must(await contentDb().from("content_publications").select("item_id, status, zernio_post_id, scheduled_for, last_error").in("item_id", ids), "pubs") as any[];
  const media = must(await contentDb().from("content_media").select("item_id, uploaded_at, used_in_post_at, status").in("item_id", ids).is("deleted_at", null), "media") as any[];
  return rows.map((r) => {
    const p = pubs.find((x) => x.item_id === r.id);
    const ms = media.filter((m) => m.item_id === r.id);
    const ready = ms.filter((m) => m.status === "ready");
    return {
      itemId: r.id, sourceKey: r.data.intake.sourceKey, file: r.data.intake.file, title: r.data.title, date: r.data.date,
      deleted: Boolean(r.deleted_at),
      pub: p ? { status: p.status, zernioPostId: p.zernio_post_id, scheduledFor: p.scheduled_for, error: p.last_error } : null,
      mediaReady: ready.length > 0,
      // הקובץ הכי ישן שעוד לא בפוסט — ממנו נמדדים 7 הימים של Zernio
      oldestUnusedUpload: ready.filter((m) => !m.used_in_post_at).map((m) => m.uploaded_at).sort()[0] || null,
    };
  });
}
