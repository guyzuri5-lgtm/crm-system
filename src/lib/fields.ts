import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "./supabase/admin";
import type { Contact, ContactField } from "./supabase/database.types";

// הגדרות השדות מ-0006_fields.sql. כמו הסטטוסים, זה נתונים ולא טיפוסים —
// cache() מאחד את כל הקריאות בתוך אותו render pass לשאילתה אחת.

export const listFields = cache(async (): Promise<ContactField[]> => {
  const { data, error } = await supabaseAdmin()
    .from("contact_fields")
    .select("*")
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
});

/** רק מה שאמור להופיע כעמודה בטבלת אנשי הקשר, לפי הסדר שנקבע. */
export async function tableFields(): Promise<ContactField[]> {
  return (await listFields()).filter((f) => f.show_in_table);
}

/** יעדים חוקיים לייבוא ולעריכה ידנית — created_at, למשל, אינו כזה. */
export async function editableFields(): Promise<ContactField[]> {
  return (await listFields()).filter((f) => f.editable);
}

/**
 * מפתח לשדה מותאם. נוצר פעם אחת ולא משתנה לעולם — הוא המפתח בתוך
 * contacts.custom, ושינוי שלו היה מחייב לכתוב מחדש את ה-jsonb של כל איש קשר
 * בכל פעם שמישהו מתקן שם תצוגה. לכן label חופשי לשינוי ו-key לא.
 */
export function generateFieldKey(): string {
  return `f_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * הערך של שדה כלשהו לאיש קשר נתון, מובנה או מותאם, כמחרוזת לתצוגה.
 * מחזיר null כשאין ערך, כדי שהקורא יחליט מה להציג במקום.
 */
export function readFieldValue(contact: Contact, field: ContactField): string | null {
  if (field.kind === "custom") {
    const value = contact.custom?.[field.key];
    return value == null || value === "" ? null : String(value);
  }

  switch (field.key) {
    case "full_name":
      return contact.full_name;
    case "phone":
      return contact.phone;
    case "email":
      return contact.email;
    case "status":
      return contact.status;
    case "source":
      return contact.source;
    case "notes":
      return contact.notes;
    case "tags":
      return contact.tags.length ? contact.tags.join(", ") : null;
    case "created_at":
      return contact.created_at;
    default:
      // שדה builtin שנוסף ל-DB בלי שהקוד כאן עודכן — עדיף להציג ריק
      // מאשר להפיל את כל הטבלה.
      return null;
  }
}
