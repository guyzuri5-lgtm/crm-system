import "server-only";

import { supabaseAdmin } from "./supabase/admin";

/**
 * העלאת תמונה לבאקט הציבורי המשותף (0023_media_bucket.sql).
 *
 * משמש את בלוקי התמונה בניוזלטר, ובהמשך גם את תמונות הרקע של דפי ההרשמה
 * לאירועים ולקורסים — אותו סוג נכס, אותם כללי גישה, ולכן פונקציה אחת.
 */

const BUCKET = "media";
const MAX_BYTES = 5 * 1024 * 1024;

// רשימה סגורה ולא בדיקת "image/*", ובעיקר: הסיומת נגזרת מכאן ולא משם הקובץ
// שהגיע מהדפדפן. קובץ בשם ‎photo.svg‎ לא יגיע לבאקט ציבורי כ-SVG — שהוא HTML
// שרץ אצל מי שפותח אותו. אותו נימוק כמו ב-uploadHostPhotoAction.
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * מחזירה את הכתובת הציבורית המלאה.
 *
 * שם אקראי בכל העלאה ולא שם קבוע: הבאקט ציבורי ונקרא דרך CDN, ותמונה
 * שנדרסת באותה כתובת ממשיכה להיות מוגשת מהמטמון גם אחרי ההחלפה.
 */
export async function uploadPublicImage(file: File, folder: string): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new Error("לא נבחר קובץ");

  const extension = IMAGE_TYPES[file.type];
  if (!extension) throw new Error("אפשר להעלות JPG, PNG, WEBP או GIF בלבד");
  if (file.size > MAX_BYTES) {
    throw new Error(`התמונה גדולה מדי (${Math.round(file.size / 1024)}KB). המקסימום הוא 5MB.`);
  }

  const db = supabaseAdmin();
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;

  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type });

  if (error) {
    // ההודעה הגולמית ("Bucket not found") לא אומרת למי שנתקל בה מה חסר.
    throw new Error(
      /bucket/i.test(error.message)
        ? "אחסון התמונות לא הוגדר. יש להריץ את supabase/migrations/0023_media_bucket.sql."
        : error.message
    );
  }

  const {
    data: { publicUrl },
  } = db.storage.from(BUCKET).getPublicUrl(path);

  return publicUrl;
}
