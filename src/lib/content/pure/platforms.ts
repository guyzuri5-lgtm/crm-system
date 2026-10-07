/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */
/**
 * כללי הרשתות ומבנה הבקשה ל-Zernio — בלי מסד ובלי רשת, כדי שאפשר יהיה לבדוק
 * אותם ישירות (tests/content/*.test.ts).
 *
 * המבנה לפי ה-OpenAPI של Zernio (גרסה 1.230.1). שלושה דברים שלא מובנים מאליהם:
 *  - באינסטגרם אין בחירה בין ריל/פוסט/קרוסלה: וידאו אחד = ריל, תמונה אחת =
 *    פוסט, כמה קבצים = קרוסלה. רק סטורי נבחר במפורש (contentType).
 *  - ביוטיוב הפרטיות היא visibility, התיאור הוא הכיתוב, והתגיות ברמה העליונה.
 *  - בטיקטוק כל פוסט צריך פרטיות, הגדרות אינטראקציה ושני דגלי הסכמה.
 */

export const PLATFORMS = ["instagram", "facebook", "tiktok", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_NAMES: Record<string, string> = {
  instagram: "אינסטגרם",
  facebook: "פייסבוק",
  tiktok: "טיקטוק",
  youtube: "יוטיוב",
};

export const CAPTION_LIMIT: Record<Platform, number> = {
  instagram: 2200,
  facebook: 63206,
  tiktok: 2200,
  youtube: 5000,
};
export const FORMATS = ["reel", "post", "carousel", "story"] as const;
export const FORMAT_NAMES: Record<string, string> = { reel: "ריל", post: "פוסט", carousel: "קרוסלה", story: "סטורי" };
export const TIKTOK_PRIVACY: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "ציבורי",
  MUTUAL_FOLLOW_FRIENDS: "חברים",
  FOLLOWER_OF_CREATOR: "עוקבים",
  SELF_ONLY: "רק אני",
};
export const YT_VISIBILITY: Record<string, string> = { public: "ציבורי", unlisted: "לא רשום", private: "פרטי" };
export const POST_STATUS_HE: Record<string, string> = {
  draft: "טיוטה",
  scheduled: "מתוזמן",
  publishing: "בתהליך עלייה",
  published: "עלה",
  partial: "עלה חלקית",
  failed: "נכשל",
  cancelled: "בוטל",
  unknown: "לא ידוע",
};
const MB = 1024 * 1024;

export interface MediaRow {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  public_url?: string;
  meta?: { duration?: number; width?: number; height?: number } | null;
  status?: string;
  uploaded_at?: string | null;
  used_in_post_at?: string | null;
}

export interface Item {
  id: string;
  date?: string;
  time?: string;
  title?: string;
  caption?: string;
  format?: string;
  platforms?: string[];
  platformOptions?: Record<string, Record<string, unknown>>;
  source?: string;
  [k: string]: unknown;
}

export interface AccountInfo {
  id: string;
  username?: string;
  displayName?: string;
  profileId?: string;
  profileUrl?: string;
}
export interface PlatformSummary {
  connected: boolean;
  healthy: boolean;
  account: AccountInfo | null;
}
export interface AccountSummary {
  platforms: Record<string, PlatformSummary>;
}

export type Validation = Record<string, { errors: string[]; warnings: string[] }>;

export function mediaKind(m: MediaRow): "video" | "image" | "other" {
  const ct = m.content_type || "";
  return ct.startsWith("video/") ? "video" : ct.startsWith("image/") ? "image" : "other";
}

export function fmt(item: Item): string {
  const f = item.format || "post";
  return (FORMATS as readonly string[]).includes(f) ? f : "post";
}

export function whenLocal(item: Item): string | null {
  if (!item.date || !item.time) return null;
  return `${item.date}T${item.time}`;
}

/** מנוע זמן בלי ספריה: הפרש אזור הזמן ברגע נתון, דרך Intl. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return asUtc - t;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

export function opts(item: Item, platform: string): Record<string, any> {
  return ((item.platformOptions || {})[platform] || {}) as Record<string, any>;
}

export function captionFor(item: Item, platform: string): string {
  const o = opts(item, platform);
  if (o.useCustomCaption && String(o.caption || "").trim()) return String(o.caption).trim();
  return String(item.caption || "").trim();
}

export function selected(item: Item): Platform[] {
  return (item.platforms || []).filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
}

const dur = (m: MediaRow) => (m.meta && typeof m.meta.duration === "number" ? m.meta.duration : undefined);

/** בדיקות מקומיות לכל רשת. "_item" = בעיות שמשותפות לכל הרשתות. */
export function validateLocal(item: Item, media: MediaRow[], acct: AccountSummary, tz: string, now = new Date()): Validation {
  const res: Validation = { _item: { errors: [], warnings: [] } };
  const f = fmt(item);
  const vids = media.filter((m) => mediaKind(m) === "video");
  const imgs = media.filter((m) => mediaKind(m) === "image");
  const n = media.length;
  const E0 = res._item.errors;

  if (!item.time) E0.push("חסרה שעת פרסום.");
  else {
    const when = zonedToUtc(whenLocal(item) || "", tz);
    if (!when) E0.push("תאריך או שעה לא תקינים.");
    else if (when.getTime() < now.getTime() + 5 * 60 * 1000)
      E0.push("שעת הפרסום צריכה להיות לפחות 5 דקות קדימה (Zernio מפרסם מיד פוסט ששעתו עברה).");
  }
  if (!selected(item).length) E0.push("לא נבחרה אף רשת.");
  if (n === 0) E0.push("לא הועלה קובץ מדיה.");
  if (f === "carousel" && n && !(n >= 2 && n <= 10)) E0.push("קרוסלה צריכה 2 עד 10 קבצים.");
  if ((f === "reel" || f === "story" || f === "post") && n > 1)
    E0.push(`${FORMAT_NAMES[f]} מקבל קובץ אחד בלבד. לכמה קבצים בחרו קרוסלה.`);
  if (f === "reel" && n === 1 && !vids.length) E0.push("ריל צריך קובץ וידאו.");
  for (const m of media) {
    if (m.status && m.status !== "ready") E0.push(`${m.filename}: עוד לא סיים לעלות.`);
    // Zernio שומר העלאה 7 ימים עד שפוסט מפנה אליה
    else if (!m.used_in_post_at && m.uploaded_at && now.getTime() - Date.parse(m.uploaded_at) > 6 * 864e5)
      E0.push(`${m.filename}: הועלה לפני יותר מ-6 ימים ו-Zernio מוחק העלאות כאלה אחרי 7. הסירו והעלו אותו שוב.`);
  }

  for (const p of selected(item)) {
    const e: string[] = [];
    const w: string[] = [];
    const info = acct.platforms[p];
    if (!info || !info.connected) e.push("לא מחובר ב-Zernio.");
    else if (!info.healthy) e.push("החשבון דורש חיבור מחדש ב-Zernio.");
    const cap = captionFor(item, p);
    const lim = CAPTION_LIMIT[p];
    if (cap.length > lim) e.push(`הכיתוב ארוך מדי: ${cap.length} מתוך ${lim} תווים.`);
    else if (cap.length > lim * 0.9) w.push(`הכיתוב קרוב לגבול (${cap.length}/${lim}).`);
    const o = opts(item, p);

    if (p === "instagram") {
      if (f === "post" && vids.length) w.push("באינסטגרם וידאו יחיד עולה כריל ולא כפוסט רגיל.");
      if (f === "story") {
        if (vids[0] && vids[0].size > 100 * MB) e.push("סטורי וידאו עד 100MB.");
        const d = vids[0] ? dur(vids[0]) : undefined;
        if (d && d > 60) e.push(`סטורי וידאו עד 60 שניות (הקובץ ${Math.round(d)} שניות).`);
        if (cap) w.push("בסטורי הכיתוב לא מוצג.");
      }
      for (const m of vids) {
        const d = dur(m);
        if (m.size > 300 * MB) e.push(`${m.filename}: וידאו באינסטגרם עד 300MB.`);
        if ((f === "reel" || f === "post") && d && !(d >= 3 && d <= 90))
          e.push(`ריל צריך להיות 3–90 שניות (הקובץ ${Math.round(d)} שניות).`);
      }
      for (const m of imgs) {
        if (!["image/jpeg", "image/png"].includes(m.content_type))
          w.push(`${m.filename}: אינסטגרם מקבל JPEG/PNG — ייתכן שיומר או יידחה.`);
        if (m.size > 8 * MB) w.push(`${m.filename}: תמונה מעל 8MB תדחס אוטומטית.`);
      }
    } else if (p === "facebook") {
      if (vids.length > 1 || (vids.length && imgs.length)) e.push("בפייסבוק אפשר וידאו אחד בלבד, בלי לערבב עם תמונות.");
      if (f === "reel" && !vids.length) e.push("ריל בפייסבוק צריך וידאו.");
      for (const m of imgs) if (m.size > 4 * MB) e.push(`${m.filename}: תמונה בפייסבוק עד 4MB.`);
      if (f === "reel" && vids[0]) {
        const d = dur(vids[0]);
        if (d && d > 90) e.push(`ריל בפייסבוק עד 90 שניות (הקובץ ${Math.round(d)}).`);
        else if (d && d > 60) w.push("לפי התיעוד של Zernio ריל בפייסבוק 3–60 שניות, לפי Meta עד 90. ייתכן שיידחה.");
      }
    } else if (p === "tiktok") {
      if (f === "story") e.push("בטיקטוק אין סטורי.");
      if (vids.length && imgs.length) e.push("בטיקטוק אי אפשר לערבב וידאו ותמונות.");
      if (vids.length > 1) e.push("בטיקטוק וידאו אחד בלבד.");
      if (imgs.length > 35) e.push("בטיקטוק עד 35 תמונות.");
      if (vids[0]) {
        const d = dur(vids[0]);
        if (d && !(d >= 3 && d <= 600)) e.push(`וידאו בטיקטוק 3 שניות עד 10 דקות (הקובץ ${Math.round(d)}).`);
      }
      if (!o.privacyLevel) e.push("צריך לבחור פרטיות לטיקטוק.");
      if (o.commercialContentType === "brand_content" && o.privacyLevel === "SELF_ONLY")
        e.push("תוכן ממומן לא יכול להיות 'רק אני'.");
    } else if (p === "youtube") {
      if (f === "story") e.push("ביוטיוב אין סטורי.");
      if (vids.length !== 1 || imgs.length) e.push("ביוטיוב צריך וידאו אחד בדיוק.");
      // ביוטיוב עולים רק Shorts. אין דגל כזה ב-API: Zernio מזהה Short לבד כשהסרטון
      // אנכי ועד 3 דקות — ולכן מה שלא עומד בשניהם היה עולה כסרטון רגיל.
      if (vids.length === 1) {
        const m = vids[0].meta || {};
        const d = dur(vids[0]);
        if (d && d > 180) e.push(`ביוטיוב עולים רק Shorts: עד 3 דקות (הקובץ ${Math.round(d)} שניות).`);
        if (m.width && m.height && m.width >= m.height)
          e.push(`ביוטיוב עולים רק Shorts: הסרטון צריך להיות אנכי (הקובץ ${m.width}×${m.height}).`);
        if (!d || !m.width || !m.height) w.push("לא הצלחתי למדוד את הסרטון — ודאו שהוא אנכי ועד 3 דקות, אחרת יעלה כסרטון רגיל ולא כ-Short.");
      }
      const title = String(o.title || "").trim();
      if (!title) e.push("ביוטיוב חובה כותרת.");
      else if (title.length > 100) e.push(`כותרת ביוטיוב עד 100 תווים (${title.length}).`);
      if (!(String(o.visibility) in YT_VISIBILITY)) e.push("צריך לבחור פרטיות ליוטיוב.");
    }
    res[p] = { errors: e, warnings: w };
  }
  return res;
}

export function isBlocked(v: Validation, item: Item): boolean {
  return v._item.errors.length > 0 || selected(item).some((p) => (v[p]?.errors.length || 0) > 0);
}

/** גוף POST/PUT /posts המדויק. מדיה בלי כתובת מקבלת placeholder שמוחלף בשליחה. */
export function buildBody(item: Item, media: MediaRow[], acct: AccountSummary, tz: string) {
  const f = fmt(item);
  const mediaItems = media.map((m) => ({
    type: mediaKind(m) === "video" ? "video" : "image",
    url: m.public_url || `{{media:${m.id}}}`,
  }));
  const base = String(item.caption || "").trim();
  const platforms: Record<string, unknown>[] = [];
  let tags: string[] | null = null;
  for (const p of selected(item)) {
    const a = acct.platforms[p]?.account;
    if (!a) continue;
    const o = opts(item, p);
    const entry: Record<string, unknown> = { platform: p, accountId: a.id };
    const cap = captionFor(item, p);
    if (cap !== base) entry.customContent = cap;
    const psd: Record<string, unknown> = {};
    if (p === "instagram") {
      if (f === "story") psd.contentType = "story";
      if ((f === "reel" || f === "post") && media[0] && mediaKind(media[0]) === "video" && o.shareToFeed === false)
        psd.shareToFeed = false;
      if (o.firstComment && f !== "story") psd.firstComment = o.firstComment;
    } else if (p === "facebook") {
      if (f === "story") psd.contentType = "story";
      else if (f === "reel") {
        psd.contentType = "reel";
        if (String(item.title || "").trim()) psd.title = String(item.title).trim().slice(0, 255);
      }
    } else if (p === "tiktok") {
      const isVideo = media.some((m) => mediaKind(m) === "video");
      const ts: Record<string, unknown> = {
        privacyLevel: o.privacyLevel,
        allowComment: o.allowComment === undefined ? true : Boolean(o.allowComment),
        // דרישת טיקטוק: הבעלים ראה את הפוסט הזה במסך האישור, סימן הסכמה ולחץ אשר.
        // השרת בודק שהסימון הגיע לפני שהוא שולח (publishing.ts).
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
      };
      if (isVideo) {
        ts.allowDuet = Boolean(o.allowDuet);
        ts.allowStitch = Boolean(o.allowStitch);
      }
      if (o.commercialContentType === "brand_organic" || o.commercialContentType === "brand_content")
        ts.commercialContentType = o.commercialContentType;
      if (o.videoMadeWithAi) ts.videoMadeWithAi = true;
      if (o.draft) ts.draft = true;
      psd.tiktokSettings = ts;
    } else if (p === "youtube") {
      psd.title = String(o.title || "").trim().slice(0, 100);
      psd.visibility = o.visibility || "private";
      psd.madeForKids = Boolean(o.madeForKids);
      if (o.categoryId) psd.categoryId = String(o.categoryId);
      if (o.containsSyntheticMedia) psd.containsSyntheticMedia = true;
      if (o.tags)
        tags = String(o.tags)
          .split(/[,\n]/)
          .map((t) => t.trim().replace(/^#/, ""))
          .filter(Boolean);
    }
    if (Object.keys(psd).length) entry.platformSpecificData = psd;
    platforms.push(entry);
  }
  const body: Record<string, unknown> = {
    content: base,
    mediaItems,
    platforms,
    scheduledFor: (whenLocal(item) || "") + ":00",
    timezone: tz,
    metadata: { ganttItemId: item.id },
  };
  if (tags) body.tags = tags;
  if (!base) delete body.content;
  return body;
}

// ── תוצאת GET /posts/{id} → מצב לכל רשת ──

export function targetState(s: string): string {
  return ({ pending: "scheduled", processing: "publishing", uploading: "publishing" } as Record<string, string>)[s] || s;
}

const CATEGORY_HE: Record<string, string> = {
  auth_expired: "החשבון התנתק מ-Zernio — צריך לחבר מחדש. ",
  user_content: "בעיה בתוכן או במדיה: ",
  account_issue: "בעיה בחשבון: ",
  platform_rejected: "הרשת דחתה את הפוסט: ",
  platform_error: "תקלה ברשת עצמה: ",
  platform_rate_limit: "הרשת הגבילה קצב — Zernio ינסה שוב: ",
  quota_exhausted: "נגמרה מכסת הפרסום היומית: ",
  system_error: "תקלה ב-Zernio: ",
};

export interface TargetUpdate {
  platform: string;
  accountId: string | null;
  status: string;
  platformPostId: string | null;
  permalink: string | null;
  error: string | null;
}

export function readPost(post: any): { status: string; targets: TargetUpdate[]; error: string | null } {
  const targets: TargetUpdate[] = [];
  const errs: string[] = [];
  for (const e of post?.platforms || []) {
    const raw = e.errorMessage || e.platformError?.message || null;
    const err = raw ? (CATEGORY_HE[e.errorCategory] || "") + raw : null;
    if (err) errs.push(`${PLATFORM_NAMES[e.platform] || e.platform}: ${err}`);
    targets.push({
      platform: e.platform,
      accountId: typeof e.accountId === "object" && e.accountId ? e.accountId._id : e.accountId || null,
      status: targetState(e.status || "pending"),
      platformPostId: e.platformPostId || null,
      permalink: e.platformPostUrl || null,
      error: err,
    });
  }
  return { status: post?.status || "scheduled", targets, error: errs.join("\n") || null };
}
