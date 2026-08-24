import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "./supabase/admin";
import type { ContactStatusRow } from "./supabase/database.types";

// מאז 0003_statuses.sql הסטטוסים הם נתונים, לא טיפוס. כל מקום שפעם עשה
// `z.enum(CONTACT_STATUSES)` או בנה <select> מהקבוע — עובר לכאן.
//
// cache() של React: כל הקריאות בתוך אותו render pass / אותו Server Action
// מתלכדות לשאילתה אחת. אין כאן קאשינג בין בקשות, בכוונה — הרשימה משתנה
// מהדשבורd וצריכה להיראות מיד.

export const listStatuses = cache(async (): Promise<ContactStatusRow[]> => {
  const { data, error } = await supabaseAdmin()
    .from("contact_statuses")
    .select("*")
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
});

/** מפה משם סטטוס לשורה שלו — לצביעת תגית בלי שאילתה נוספת לכל שורה בטבלה. */
export async function statusMap(): Promise<Map<string, ContactStatusRow>> {
  return new Map((await listStatuses()).map((s) => [s.name, s]));
}

/**
 * ולידציה בזמן ריצה מול ה-DB. מחזיר את השם המנורמל אם הוא סטטוס קיים,
 * אחרת null. משמש בכל Server Action ובכל route שמקבל סטטוס מבחוץ.
 */
export async function resolveStatus(value: unknown): Promise<string | null> {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const statuses = await listStatuses();
  return statuses.find((s) => s.name === trimmed)?.name ?? null;
}

/** סטטוס ברירת המחדל לליד חדש — הראשון בסדר התצוגה, כמו הטריגר ב-DB. */
export async function defaultStatus(): Promise<string | null> {
  return (await listStatuses())[0]?.name ?? null;
}
