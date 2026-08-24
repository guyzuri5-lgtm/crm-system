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
  manychat_template_id: z.string().optional(),
});

export async function createTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createTemplateSchema.safeParse({
    channel: formData.get("channel"),
    name: formData.get("name"),
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
    manychat_template_id: formData.get("manychat_template_id") || undefined,
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
