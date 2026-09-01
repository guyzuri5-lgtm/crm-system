"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  listMetaTemplates,
  createMetaTemplate,
  deleteMetaTemplate,
  META_TEMPLATE_CATEGORIES,
} from "@/lib/whatsapp-cloud";
import { MESSAGE_CHANNELS } from "@/lib/supabase/database.types";

const createTemplateSchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS),
  name: z.string().min(1, "חובה למלא שם לתבנית"),
  subject: z.string().optional(),
  body: z.string().min(1, "חובה למלא תוכן"),
  // ריק = התבנית שמישה רק בתוך חלון 24 השעות. Meta מגבילה שמות לאותיות
  // אנגליות קטנות, ספרות וקו תחתון, ולכן שם לא חוקי נתפס כאן ולא בשליחה.
  meta_template_name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, "שם תבנית ב-Meta מכיל אותיות אנגליות קטנות, ספרות וקו תחתון בלבד")
    .max(512)
    .nullable(),
  meta_language_code: z.string().trim().min(2).max(10),
  meta_variables: z.array(z.string().trim().min(1)),
});

/**
 * שורה לכל משתנה בתיבת טקסט → מערך מסודר.
 *
 * הסדר הוא המשמעות כאן: האיבר הראשון ממלא את {{1}} בתבנית המאושרת, השני את
 * {{2}} וכן הלאה. שורות ריקות מסוננות כדי ששורה מיותרת בסוף לא תשלח פרמטר ריק
 * ל-Meta, שדוחה אותו.
 */
function readVariables(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function createTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createTemplateSchema.safeParse({
    channel: formData.get("channel"),
    name: formData.get("name"),
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
    meta_template_name: String(formData.get("meta_template_name") ?? "").trim() || null,
    meta_language_code: String(formData.get("meta_language_code") ?? "").trim() || "he",
    meta_variables: readVariables(String(formData.get("meta_variables") ?? "")),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { error } = await supabaseAdmin().from("message_templates").insert(parsed.data);
  if (error) throw error;

  revalidatePath("/templates");
}

export async function deleteTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("message_templates").delete().eq("id", id);
  if (error) {
    // FK from automation_rules.action_template_id is ON DELETE RESTRICT on purpose.
    throw new Error(
      error.code === "23503"
        ? "אי אפשר למחוק תבנית שמשויכת לכלל אוטומציה קיים — כבו/מחקו את הכלל קודם"
        : error.message
    );
  }

  revalidatePath("/templates");
}

// ── סנכרון מול Meta ────────────────────────────────────────────────────────

/**
 * מושך את מצב כל התבניות מ-Meta ומעדכן את הרשומות המקומיות.
 *
 * ההתאמה היא לפי (שם, שפה) ולא לפי מזהה: הרשומות הקיימות נוצרו לפני שהיה
 * meta_template_id, ואותו שם יכול להתקיים בכמה שפות כתבניות נפרדות אצל Meta.
 *
 * רשומה ששמה לא נמצא מסומנת MISSING ולא נמחקת. מחיקה אוטומטית של רשומה
 * מקומית על סמך קריאת רשת אחת היא הרסנית מדי — קריאה שנכשלה חלקית הייתה
 * מוחקת תבניות עובדות. סימון גלוי מוסר את אותה בעיה בלי הסיכון.
 */
export async function syncMetaTemplatesAction() {
  await verifyTeamMember();

  const remote = await listMetaTemplates();
  const byKey = new Map(remote.map((t) => [`${t.name}|${t.language}`, t]));

  const db = supabaseAdmin();
  const { data: locals, error } = await db
    .from("message_templates")
    .select("id, meta_template_name, meta_language_code")
    .not("meta_template_name", "is", null);
  if (error) throw error;

  const now = new Date().toISOString();

  await Promise.all(
    (locals ?? []).map((local) => {
      const match = byKey.get(`${local.meta_template_name}|${local.meta_language_code}`);
      return db
        .from("message_templates")
        .update({
          meta_template_id: match?.id ?? null,
          meta_status: match?.status ?? "MISSING",
          meta_category: match?.category ?? null,
          meta_rejected_reason: match?.rejectedReason ?? null,
          meta_synced_at: now,
        })
        .eq("id", local.id);
    })
  );

  revalidatePath("/templates");
}

// ── יצירה ב-Meta ───────────────────────────────────────────────────────────

const metaCreateSchema = z.object({
  name: z.string().trim().min(1, "חובה למלא שם פנימי"),
  meta_template_name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, "שם ב-Meta מכיל אותיות אנגליות קטנות, ספרות וקו תחתון בלבד")
    .max(512),
  meta_language_code: z.string().trim().min(2).max(10),
  category: z.enum(META_TEMPLATE_CATEGORIES),
  body: z.string().trim().min(1, "חובה למלא תוכן"),
});

/**
 * יוצרת תבנית ב-Meta ורושמת אותה מקומית — פעולה אחת במקום שתיים.
 *
 * הנוסח נכתב פעם אחת עם המציינים המוכרים ({{first_name}}), ומכאן נגזרות שתי
 * הצורות: Meta מקבלת {{1}} ממוספר, והרשומה המקומית שומרת את סדר המציינים
 * ב-meta_variables כדי שהשליחה תדע מה למלא. קודם היה צריך לכתוב את שתיהן
 * ביד ולהקפיד שהסדר תואם — מקור קבוע לשליחות שנכשלות.
 */
export async function createMetaTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = metaCreateSchema.safeParse({
    name: formData.get("name"),
    meta_template_name: formData.get("meta_template_name"),
    meta_language_code: String(formData.get("meta_language_code") ?? "").trim() || "he",
    category: formData.get("category"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const input = parsed.data;

  // המציינים לפי סדר הופעתם — הם גם רשימת המשתנים וגם המיפוי ל-{{1}}, {{2}}.
  const variables: string[] = [];
  const metaBody = input.body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match) => {
    variables.push(match);
    return `{{${variables.length}}}`;
  });

  const created = await createMetaTemplate({
    name: input.meta_template_name,
    language: input.meta_language_code,
    category: input.category,
    body: metaBody,
    // Meta דורשת דוגמה לכל משתנה, אחרת היא דוחה. הערכים לא מגיעים לאף לקוח —
    // הם רק מה שהמאשר האנושי רואה כשהוא בודק איך ההודעה נראית.
    exampleValues: variables.map(() => "ישראל"),
  });

  const { error } = await supabaseAdmin().from("message_templates").insert({
    channel: "whatsapp",
    name: input.name,
    body: input.body,
    meta_template_name: input.meta_template_name,
    meta_language_code: input.meta_language_code,
    meta_variables: variables,
    meta_template_id: created.id,
    meta_status: created.status ?? "PENDING",
    meta_category: created.category ?? input.category,
    meta_synced_at: new Date().toISOString(),
  });
  if (error) throw error;

  revalidatePath("/templates");
}

/** מוחקת את התבנית ב-Meta ומנתקת את הרשומה המקומית ממנה. */
export async function deleteFromMetaAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: template, error } = await db
    .from("message_templates")
    .select("meta_template_name")
    .eq("id", id)
    .single();
  if (error) throw error;
  if (!template.meta_template_name) throw new Error("לרשומה הזו אין תבנית ב-Meta");

  await deleteMetaTemplate(template.meta_template_name);

  // הרשומה המקומית נשארת ומאבדת את הקישור. היא עדיין שמישה בתוך חלון
  // 24 השעות כטקסט חופשי, וייתכן שכלל אוטומציה מצביע עליה.
  const { error: updateError } = await db
    .from("message_templates")
    .update({
      meta_template_name: null,
      meta_template_id: null,
      meta_status: null,
      meta_category: null,
      meta_rejected_reason: null,
      meta_synced_at: null,
    })
    .eq("id", id);
  if (updateError) throw updateError;

  revalidatePath("/templates");
}
