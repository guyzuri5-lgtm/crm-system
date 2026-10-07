import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * לקוח service role לטבלאות content_* (0045_content_gantt.sql).
 *
 * לא ה-supabaseAdmin המשותף: הוא מוקלד מול database.types.ts, והטבלאות האלה
 * לא שם (הקובץ נוצר מהסכימה ועוד לא חודש). לקוח נפרד בלי טיפוסים עדיף על
 * עריכה ידנית של קובץ שנוצר אוטומטית. אותו מפתח, אותן הרשאות.
 */
let _db: SupabaseClient | undefined;
export function contentDb(): SupabaseClient {
  if (!_db) {
    _db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

export class DbError extends Error {}

/** זורק על שגיאת מסד. כל קריאה כאן עוברת דרכו — שגיאה שקטה היא נתון שאבד. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`);
  // maybeSingle() מחזיר null כשאין שורה — הקוראים בודקים את זה בעצמם
  return res.data as NonNullable<T>;
}

export async function getMeta<T = unknown>(key: string, fallback: T | null = null): Promise<T | null> {
  const data = must(await contentDb().from("content_meta").select("value").eq("key", key).maybeSingle(), `meta ${key}`);
  return data ? (data.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown) {
  must(
    await contentDb().from("content_meta").upsert({ key, value, updated_at: new Date().toISOString() }),
    `meta ${key}`,
  );
}

export async function deleteMeta(key: string) {
  must(await contentDb().from("content_meta").delete().eq("key", key), `meta ${key}`);
}

export interface ContentSettings {
  timezone: string;
  /**
   * המתג הראשי לכל יצירה/שינוי/מחיקה ב-Zernio. כבוי עד שהבעלים מדליק אותו,
   * כדי ששום דבר — מסך, עובד רקע, בדיקה — לא יכתוב בטעות.
   */
  writesEnabled: boolean;
  /** כמה דקות לפני הפרסום העובד יוצר אוטומציה שממתינה לפוסט מתוזמן */
  armLeadMinutes: number;
}
const DEFAULT_SETTINGS: ContentSettings = { timezone: "Asia/Jerusalem", writesEnabled: false, armLeadMinutes: 3 };

export async function getSettings(): Promise<ContentSettings> {
  const s = (await getMeta<Partial<ContentSettings>>("settings")) || {};
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function updateSettings(patch: Partial<ContentSettings>) {
  const s = { ...(await getSettings()), ...patch };
  await setMeta("settings", s);
  return s;
}

/** מנעול קצר שמשתחרר לבד (content_try_lease). true רק למי שתפס. */
export async function tryLease(key: string, seconds: number): Promise<boolean> {
  const { data, error } = await contentDb().rpc("content_try_lease", { p_key: key, p_seconds: seconds });
  if (error) throw new DbError(`lease ${key}: ${error.message}`);
  return Boolean(data);
}

export const nowIso = () => new Date().toISOString();
