import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות Drive ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { google, type drive_v3 } from "googleapis";
import { contentDb, getMeta, must, nowIso } from "./db";
import { readIg } from "./ig/refresh";
import { extractScript, isDuplicateScript, normPermalink, parsePieceNo, pieceName, rankCandidates, titleFromDocName } from "./pure/pieces";

/**
 * פיסות תוכן (0047_content_pieces.sql): מספר סידורי אחד שעובר מהמסמך בדרייב,
 * דרך הסרטון המצולם והגאנט, ועד הביצועים באינסטגרם.
 *
 * 1. syncPrompter — מסמך שנכנס לאחת מתיקיות הפרומפטר מקבל את המספר הבא,
 *    והשם שלו בדרייב הופך ל-"13- כותרת". הטקסט של "גרסה בשפה שלי" נשמר כאן.
 * 2. matchVideo — הסקיל talking-head-to-ae שולח תמלול של סרטון חדש, ומקבל
 *    את הפיסה שצולמה ואת השם לתיקייה. ההתאמה לפי מילים (pure/pieces.ts).
 * 3. linkItems — פריט בגאנט שה-sourceKey שלו מתחיל במספר נקשר לפיסה.
 * 4. syncMetrics — הרילס שעלה (content_targets) מול הנתונים שהניתוח שלף
 *    מאינסטגרם (content_ig_imports) → metrics בשורה של הפיסה.
 * (הביצועים נשמרים רק כאן, בטבלה. גיליון הביצועים בדרייב בוטל ב-2026-10-12 — דאשבורד ייבנה בנפרד.)
 *
 * דרייב: אותם GOOGLE_CLIENT_ID/SECRET, עם GOOGLE_DRIVE_REFRESH_TOKEN נפרד
 * (scope drive), כדי לא לגעת בטוקן של המייל והיומן. מפיקים: npm run auth:google -- --drive
 */

const DEFAULT_CONFIG = {
  // שתי תיקיות הפרומפטר (כולל תתי-התיקיות שלהן: "צולם", "סרטונים שצולמו")
  prompterFolders: [
    { id: "1Ijsif5QU5txN4WZ-9KlC5yHWnmYl6POR", source: "youtube" },
    { id: "1Vt5ot23EPL_Ii9HJQWIVntIP8RWLiHUk", source: "instagram" },
  ],
};
type PiecesConfig = typeof DEFAULT_CONFIG;

async function config(): Promise<PiecesConfig> {
  const c = (await getMeta<Partial<PiecesConfig>>("pieces_config")) || {};
  return { ...DEFAULT_CONFIG, ...c };
}

export class DriveNotConfiguredError extends Error {
  constructor() {
    super("דרייב לא מחובר: חסר GOOGLE_DRIVE_REFRESH_TOKEN (npm run auth:google -- --drive).");
  }
}

function drive(): drive_v3.Drive {
  const token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !token) throw new DriveNotConfiguredError();
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: token });
  return google.drive({ version: "v3", auth });
}

const DOC = "application/vnd.google-apps.document";
const FOLDER = "application/vnd.google-apps.folder";

async function listChildren(d: drive_v3.Drive, folderId: string) {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const r = await d.files.list({
      q: `'${folderId}' in parents and trashed = false and (mimeType = '${DOC}' or mimeType = '${FOLDER}')`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 200,
      pageToken,
    });
    out.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/** כל המסמכים בתיקיית פרומפטר ובתתי-התיקיות שלה (עד שתי רמות) */
async function prompterDocs(d: drive_v3.Drive, rootId: string) {
  const docs: drive_v3.Schema$File[] = [];
  const walk = async (id: string, depth: number) => {
    for (const f of await listChildren(d, id)) {
      if (f.mimeType === DOC) docs.push(f);
      else if (f.mimeType === FOLDER && depth < 2) await walk(f.id!, depth + 1);
    }
  };
  await walk(rootId, 0);
  return docs;
}

async function docText(d: drive_v3.Drive, id: string): Promise<string> {
  const r = await d.files.export({ fileId: id, mimeType: "text/plain" }, { responseType: "text" });
  return String(r.data || "");
}

/**
 * מספר שכבר מופיע בשם המסמך ("13- כותרת") נשמר אם הוא פנוי. אם הוא תפוס על ידי
 * מסמך אחר — זה כמעט תמיד עותק של מסמך קיים, ולכן מדלגים ומדווחים (null) במקום
 * לתת לו מספר חדש. בלי מספר בשם, המונה נותן את הבא. piece_no הוא המפתח הראשי,
 * כך ששני מסמכים לא יכולים לקבל אותו מספר גם בשתי ריצות במקביל.
 */
async function insertPiece(row: Record<string, unknown>): Promise<number | null> {
  const res = await contentDb().from("content_pieces").insert(row).select("piece_no").single();
  if (res.error && row.piece_no != null && /duplicate key|content_pieces_pkey/.test(res.error.message)) return null;
  // ריצה מקבילה (עובד הרקע מול pieces/sync ידני) כבר הכניסה את אותו מסמך — מדלגים, לא מפילים את כל הסנכרון
  if (res.error && /content_pieces_drive_doc_id_key/.test(res.error.message)) return null;
  return (must(res, "piece insert") as any).piece_no;
}

export async function syncPrompter(log: (m: string) => void = () => {}) {
  const d = drive();
  const cfg = await config();
  const existing = must(await contentDb().from("content_pieces").select("piece_no, drive_doc_id, doc_modified, script"), "pieces") as any[];
  const byDoc = new Map(existing.filter((p) => p.drive_doc_id).map((p) => [p.drive_doc_id, p]));
  let added = 0;
  let refreshed = 0;

  for (const folder of cfg.prompterFolders) {
    for (const f of await prompterDocs(d, folder.id)) {
      const known = byDoc.get(f.id);
      if (known) {
        // גיא ערך את המסמך אחרי שנכנס לפרומפטר — הטקסט להתאמה מתעדכן
        if (!known.script || (f.modifiedTime && f.modifiedTime !== known.doc_modified)) {
          const script = extractScript(await docText(d, f.id!));
          must(await contentDb().from("content_pieces").update({ script, doc_modified: f.modifiedTime, updated_at: nowIso() })
            .eq("piece_no", known.piece_no), "piece script");
          refreshed++;
        }
        continue;
      }
      const title = titleFromDocName(f.name || "");
      const script = extractScript(await docText(d, f.id!));
      const wanted = parsePieceNo(f.name || "");
      // עותק של מסמך שכבר ממוספר: ממשיכים רק עם המקור (זה שמקושר לסרטון, אם צולם)
      const original = !wanted && script ? existing.find((p) => p.script && isDuplicateScript(script, p.script)) : null;
      if (original) {
        log(`דילוג: "${f.name}" הוא עותק של #${original.piece_no}`);
        continue;
      }
      const pieceNo = await insertPiece({
        ...(wanted ? { piece_no: wanted } : {}),
        title, drive_doc_id: f.id, drive_folder: folder.source, script, doc_modified: f.modifiedTime, status: "prompter",
      });
      if (pieceNo == null) {
        log(`דילוג: "${f.name}" נושא מספר שכבר שייך למסמך אחר (עותק?), או שנוסף כבר בריצה מקבילה`);
        continue;
      }
      const name = pieceName(pieceNo, title);
      if (name !== f.name) {
        const upd = await d.files.update({ fileId: f.id!, requestBody: { name }, fields: "modifiedTime" });
        // השינוי בשם מעדכן את modifiedTime — שומרים אותו כדי לא לקרוא שוב סתם
        must(await contentDb().from("content_pieces").update({ doc_modified: upd.data.modifiedTime }).eq("piece_no", pieceNo), "piece modified");
      }
      byDoc.set(f.id!, { piece_no: pieceNo });
      existing.push({ piece_no: pieceNo, drive_doc_id: f.id, script });
      log(`#${pieceNo} ${title}`);
      added++;
    }
  }
  return { added, refreshed };
}

/** התאמת סרטון מצולם לפיסה. commit=true רושם את התיקייה רק כשההתאמה בטוחה. */
export async function matchVideo(b: Record<string, any>) {
  const transcript = String(b.transcript || "").slice(0, 20000);
  if (transcript.trim().length < 20) throw new Error("חסר תמלול");
  const rows = must(await contentDb().from("content_pieces").select("piece_no, title, script").is("video_folder", null), "unfilmed") as any[];
  const { best, confident, ranked } = rankCandidates(transcript, rows.map((r) => ({ pieceNo: r.piece_no, title: r.title, script: r.script })));
  const folderName = best ? pieceName(best.pieceNo, best.title) : null;
  if (b.commit && confident && best) {
    must(await contentDb().from("content_pieces").update({
      video_folder: folderName, match_score: best.score, status: "filmed", filmed_at: nowIso(), updated_at: nowIso(),
    }).eq("piece_no", best.pieceNo).is("video_folder", null), "piece filmed");
  }
  return { confident, match: best ? { pieceNo: best.pieceNo, title: best.title, score: best.score, folderName } : null, candidates: ranked };
}

/** שיוך ידני, כשההתאמה לא הייתה בטוחה וגיא בחר */
export async function confirmVideo(b: Record<string, any>) {
  const pieceNo = Number(b.pieceNo);
  const row = must(await contentDb().from("content_pieces").select("piece_no, title, video_folder").eq("piece_no", pieceNo).maybeSingle(), "piece") as any;
  if (!row) throw new Error(`אין פיסה #${pieceNo}`);
  const folderName = pieceName(row.piece_no, row.title);
  must(await contentDb().from("content_pieces").update({
    video_folder: folderName, status: "filmed", filmed_at: nowIso(), updated_at: nowIso(),
  }).eq("piece_no", pieceNo), "piece confirm");
  return { pieceNo, title: row.title, folderName };
}

/** פריטי גאנט שהגיעו מתיקייה ממוספרת ("dir:13- כותרת") → item_id בפיסה */
export async function linkItems() {
  const items = must(await contentDb().from("content_items").select("id, data").is("deleted_at", null).not("data->intake", "is", null), "intake items") as any[];
  const pieces = must(await contentDb().from("content_pieces").select("piece_no, item_id, status"), "pieces") as any[];
  const byNo = new Map(pieces.map((p) => [p.piece_no, p]));
  let linked = 0;
  for (const it of items) {
    const n = parsePieceNo(String(it.data?.intake?.sourceKey || "")) ?? (Number(it.data?.pieceNo) || null);
    const p = n != null ? byNo.get(n) : null;
    if (!p || p.item_id === it.id) continue;
    must(await contentDb().from("content_pieces").update({
      item_id: it.id, status: p.status === "published" ? "published" : "in_gantt", updated_at: nowIso(),
    }).eq("piece_no", n), "piece link");
    linked++;
  }
  return { linked };
}

const METRIC_KEYS = ["views", "reach", "likes", "comments", "shares", "saved", "totalInteractions", "watchTimeS", "durationS"];

/** הרילס של כל פיסה (מ-Zernio) מול הנתונים שנשלפו מאינסטגרם */
export async function syncMetrics() {
  const pieces = must(await contentDb().from("content_pieces").select("piece_no, item_id, ig_media_id, ig_permalink, metrics, published_at")
    .or("item_id.not.is.null,ig_media_id.not.is.null,ig_permalink.not.is.null"), "pieces") as any[];
  if (!pieces.length) return { updated: 0 };
  const itemIds = pieces.map((p) => p.item_id).filter(Boolean);
  const targets = itemIds.length
    ? must(await contentDb().from("content_targets").select("item_id, platform_post_id, permalink, status").eq("platform", "instagram").in("item_id", itemIds), "ig targets") as any[]
    : [];
  const { posts } = await readIg();
  const byId = new Map(posts.map((p: any) => [String(p.id), p]));
  const byLink = new Map<string, any>();
  for (const p of posts as any[]) {
    const k = normPermalink(p.permalink);
    if (k) byLink.set(k, p);
  }
  let updated = 0;
  for (const piece of pieces) {
    const t = targets.find((x) => x.item_id === piece.item_id);
    const mediaId = piece.ig_media_id || t?.platform_post_id || null;
    const link = piece.ig_permalink || t?.permalink || null;
    const linkKey = normPermalink(link);
    const post: any = (mediaId && byId.get(String(mediaId))) || (linkKey && byLink.get(linkKey)) || null;
    if (!post && !mediaId && !link) continue;
    const metrics = post ? Object.fromEntries(METRIC_KEYS.map((k) => [k, post[k] ?? null])) : piece.metrics;
    const patch: Record<string, unknown> = {
      ig_media_id: post?.id ?? mediaId, ig_permalink: post?.permalink ?? link, metrics, updated_at: nowIso(),
    };
    if (post) {
      patch.metrics_at = nowIso();
      patch.status = "published";
      patch.published_at = piece.published_at || post.timestamp || nowIso();
    }
    if (JSON.stringify(metrics) === JSON.stringify(piece.metrics) && piece.ig_media_id === patch.ig_media_id) continue;
    must(await contentDb().from("content_pieces").update(patch).eq("piece_no", piece.piece_no), "piece metrics");
    updated++;
  }
  return { updated };
}

export async function listPieces() {
  return must(await contentDb().from("content_pieces").select("*").order("piece_no"), "pieces") as any[];
}

/** ריצה אחת של כל השלבים. נקראת מעובד הרקע (פעם ב-5 דקות) ומהכפתור/הסקיל. */
export async function runPieces(log: (m: string) => void = () => {}) {
  const out: Record<string, unknown> = {};
  out.prompter = await syncPrompter(log);
  out.items = await linkItems();
  out.metrics = await syncMetrics();
  return out;
}
