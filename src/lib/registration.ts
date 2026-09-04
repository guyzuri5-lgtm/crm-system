import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { normalizePhone, usableEmail } from "./quiz";
import type { EventStage } from "./supabase/database.types";

/**
 * מה שמשותף להרשמה לאירוע ולהרשמה לקורס.
 *
 * שלושת הדברים כאן אינם "של אירועים" ואינם "של קורסים" — הם של *הרשמה*:
 * איך מוצאים או יוצרים איש קשר, איך שלב עולה בדרגה, ואיך שם הופך לכתובת.
 * הם ישבו ב-events.ts עד שהקורסים נבנו, וזה עבד כל עוד היה צרכן אחד.
 *
 * הם עברו לכאן ולא שוכפלו, כי שכפול של findOrCreateContact הוא בדיוק הבאג
 * שהוא עצמו נכתב כדי למנוע: שתי הגדרות של "מי נחשב אותו אדם" פירושן שאותה
 * לקוחה תיווצר פעמיים ב-contacts — פעם מהאירוע ופעם מהקורס.
 */

type Db = ReturnType<typeof supabaseAdmin>;

// ── שלב ההרשמה ─────────────────────────────────────────────────────────────

const STAGE_RANK: Record<EventStage, number> = { interested: 0, registered: 1, paid: 2 };

/**
 * השלב עולה בדרגה בלבד.
 *
 * מי ששילמה וממלאת את הטופס שוב (רענון, לחיצה כפולה, חזרה מגרואו) לא חוזרת
 * להיות "נרשמה ולא שילמה" — אחרת היא הייתה מופיעה ברשימת "דורש טיפול"
 * ומקבלת מסע למתעניינות אחרי שכבר שילמה.
 */
export function strongerStage(current: EventStage | undefined, incoming: EventStage): EventStage {
  if (!current) return incoming;
  return STAGE_RANK[incoming] > STAGE_RANK[current] ? incoming : current;
}

// ── כתובת הקישור ───────────────────────────────────────────────────────────

/**
 * הצעת slug משם.
 *
 * עברית נושרת, ולכן שם עברי לגמרי מחזיר מחרוזת ריקה — במקרה הזה הטופס
 * מבקש מהמשתמש לכתוב כתובת בעצמו במקום לייצר "course-a7f3" חסר משמעות
 * שיישלח אחר כך לקהל.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

// ── איש הקשר ───────────────────────────────────────────────────────────────

export interface RegistrantDetails {
  fullName: string;
  phone: string;
  email: string;
}

/**
 * איתור-או-יצירה של איש קשר, באותו דפוס בדיוק כמו ב-webhook של השאלון:
 * התאמה לפי טלפון (ייחודי בסכימה) ואז לפי אימייל, בלי לדרוס ערכים קיימים
 * בריקים, ובלי לגעת ב-status — הוא שדה שהצוות מנהל ידנית.
 *
 * `sourceLabel` הוא מה שנרשם ב-source ובתגית, והוא מגיע מהקורא ולא נבנה כאן
 * ("אירוע: ערב פתיחה" / "קורס: מדיטציה"). כך הפונקציה לא צריכה לדעת מה
 * נרשמים אליו — וזה מה שהופך אותה למשותפת באמת.
 */
export async function findOrCreateContact(
  db: Db,
  details: RegistrantDetails,
  sourceLabel: string
): Promise<{ id: string } | { error: string }> {
  const email = usableEmail(details.email);
  const phone = normalizePhone(details.phone);
  if (!email && !phone) return { error: "צריך טלפון או אימייל תקין" };

  let existing: { id: string; full_name: string | null; email: string | null; tags: string[] } | null =
    null;

  if (phone) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").eq("phone", phone).maybeSingle();
    if (error) return { error: error.message };
    existing = data;
  }
  if (!existing && email) {
    const { data, error } = await db
      .from("contacts").select("id, full_name, email, tags").ilike("email", email).limit(1);
    if (error) return { error: error.message };
    existing = data?.[0] ?? null;
  }

  const newTags = [sourceLabel];

  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), ...newTags]));
    const { error } = await db
      .from("contacts")
      .update({
        full_name: existing.full_name ?? (details.fullName || null),
        email: existing.email ?? email,
        tags,
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    return { id: existing.id };
  }

  const { data, error } = await db
    .from("contacts")
    .insert({
      full_name: details.fullName || null,
      phone,
      email,
      source: sourceLabel,
      tags: newTags,
    })
    .select("id")
    .single();

  if (error) {
    // מרוץ: מישהו יצר את אותו טלפון בין הבדיקה לכתיבה.
    if (error.code === "23505" && phone) {
      const { data: retry } = await db.from("contacts").select("id").eq("phone", phone).maybeSingle();
      if (retry) return { id: retry.id };
    }
    return { error: error.message };
  }
  return { id: data.id };
}
