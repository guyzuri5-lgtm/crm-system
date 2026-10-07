import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * מייל שנאסף בצ'אט של אוטומציה באינסטגרם → איש קשר ב-CRM.
 * אותו דפוס כמו upsertRegistrant ב-registration.ts: מוצאים לפי מייל
 * (case-insensitive), מוסיפים תגית, ולא דורסים שם או מייל שכבר קיימים.
 * לא מפעיל כללי אוטומציה ולא שולח כלום — הבעלים שולח את השיעור בעצמו.
 */
export async function saveEmailContact(email: string, automationName: string): Promise<string | null> {
  const db = supabaseAdmin();
  const tags = ["אינסטגרם", `אוטומציה: ${automationName}`];
  const { data: found, error } = await db.from("contacts").select("id, tags").ilike("email", email).limit(1);
  if (error) throw new Error(error.message);
  const existing = found?.[0];
  if (existing) {
    const merged = Array.from(new Set([...(existing.tags ?? []), ...tags]));
    const { error: upErr } = await db.from("contacts").update({ tags: merged }).eq("id", existing.id);
    if (upErr) throw new Error(upErr.message);
    return existing.id;
  }
  const { data, error: insErr } = await db
    .from("contacts")
    .insert({ email, source: "אינסטגרם", tags })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  return data.id;
}
