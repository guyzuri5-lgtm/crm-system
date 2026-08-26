"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
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
