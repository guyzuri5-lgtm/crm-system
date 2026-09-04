import "server-only";

import { cache } from "react";
import { supabaseAdmin } from "./supabase/admin";
import type { CourseRow, CourseStage } from "./supabase/database.types";

/**
 * שכבת הנתונים של הקורסים — משותפת לדף ההרשמה הציבורי ולמסכי הניהול.
 *
 * מה שאין כאן מסביר את הקובץ יותר ממה שיש: אין spotsLeft (מוצר דיגיטלי לא
 * נגמר), אין קישורי יומן (אין תאריך), ואין מנוע תזכורות. מה שמשותף להרשמה
 * לאירוע ולהרשמה לקורס — איתור איש קשר, דירוג שלבים ו-slugify — יושב
 * ב-registration.ts ואינו משוכפל לכאן.
 */

/**
 * "הטבלה לא קיימת" — כלומר הקוד עלה אבל 0028 עוד לא הורצה. אותו דפוס כמו
 * assertEventsMigrated, ומאותה סיבה: ההודעה הגולמית של PostgREST לא אומרת
 * למי שנתקל בה מה לעשות.
 */
export function assertCoursesMigrated(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "")) {
    throw new Error(
      "טבלאות הקורסים לא קיימות. יש להריץ את supabase/migrations/0028_courses.sql ואת 0029_activity_course.sql ב-SQL editor של Supabase."
    );
  }
}

// ── שליפה ──────────────────────────────────────────────────────────────────

/** הקורס הפעיל שמאחורי /course/{slug}. cache() מאחד קריאות באותו render. */
export const getActiveCourseBySlug = cache(async (slug: string): Promise<CourseRow | null> => {
  const { data, error } = await supabaseAdmin()
    .from("courses")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  assertCoursesMigrated(error);
  if (error) throw error;
  return data;
});

export const getCourseById = cache(async (id: string): Promise<CourseRow | null> => {
  const { data, error } = await supabaseAdmin()
    .from("courses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  assertCoursesMigrated(error);
  if (error) throw error;
  return data;
});

/**
 * הקורס שאליו משויכים לידים מה-webhook הישן, אם סומן כזה.
 *
 * מחזירה null בשקט גם כשהטבלה עדיין לא קיימת: הקורא היחיד הוא ה-webhook של
 * דף הנחיתה, והוא עבד מצוין לפני שהקורסים נבנו. נפילה שלו בגלל מיגרציה
 * שטרם הורצה הייתה מפילה קליטת לידים אמיתית בשביל תכונה נלווית.
 */
export async function getLegacyCourse(): Promise<CourseRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("courses")
    .select("*")
    .eq("legacy_webhook", true)
    .eq("active", true)
    .maybeSingle();

  if (error) return null;
  return data;
}

export interface CourseStageCounts {
  interested: number;
  /** התחילו ולא שילמו */
  registered: number;
  paid: number;
}

/**
 * שלושת המונים של קורס, בשאילתה אחת לכל שלב.
 *
 * נספרות השורות ולא נשלפות: קורס עם 300 נרשמות לא צריך להעביר 300 שורות
 * לשרת רק כדי להציג שלושה מספרים.
 */
export async function countCourseStages(courseId: string): Promise<CourseStageCounts> {
  const db = supabaseAdmin();
  const stages: CourseStage[] = ["interested", "registered", "paid"];

  const counts = await Promise.all(
    stages.map(async (stage) => {
      const { count, error } = await db
        .from("course_registrations")
        .select("id", { count: "exact", head: true })
        .eq("course_id", courseId)
        .eq("stage", stage);
      assertCoursesMigrated(error);
      if (error) throw error;
      return count ?? 0;
    })
  );

  return { interested: counts[0], registered: counts[1], paid: counts[2] };
}
