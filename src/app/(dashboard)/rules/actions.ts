"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  AUTOMATION_TRIGGER_TYPES,
  MESSAGE_CHANNELS,
} from "@/lib/supabase/database.types";
import { resolveStatus } from "@/lib/statuses";

// הסטטוסים אינם enum מאז 0003_statuses.sql, אז הם לא חלק מהסכמה הזו —
// שדות הסטטוס נבדקים מול ה-DB אחרי הפענוח (ראו resolveStatus למטה).
const createRuleSchema = z.object({
  trigger_type: z.enum(AUTOMATION_TRIGGER_TYPES),
  action_channel: z.enum(MESSAGE_CHANNELS),
  action_template_id: z.string().uuid("בחרו תבנית"),
  days: z.coerce.number().int().positive().optional(),
});

export async function createRuleAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createRuleSchema.safeParse({
    trigger_type: formData.get("trigger_type"),
    action_channel: formData.get("action_channel"),
    action_template_id: formData.get("action_template_id"),
    days: formData.get("days") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const data = parsed.data;

  const rawFromStatus = String(formData.get("from_status") ?? "");
  const rawStatus = String(formData.get("status") ?? "");
  const fromStatus = rawFromStatus ? await resolveStatus(rawFromStatus) : null;
  const status = rawStatus ? await resolveStatus(rawStatus) : null;

  if (rawFromStatus && !fromStatus) throw new Error("סטטוס יציאה לא תקין");
  if (rawStatus && !status) throw new Error("סטטוס יעד לא תקין");

  if (data.trigger_type === "time_since_no_reply" && (!data.days || !status)) {
    throw new Error("לכלל מסוג 'זמן ללא מענה' חובה למלא ימים וסטטוס יעד");
  }

  const db = supabaseAdmin();

  const { data: template, error: templateError } = await db
    .from("message_templates")
    .select("channel")
    .eq("id", data.action_template_id)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template) throw new Error("תבנית לא נמצאה");
  if (template.channel !== data.action_channel) {
    throw new Error("ערוץ הפעולה חייב להתאים לערוץ של התבנית שנבחרה");
  }

  const trigger_value =
    data.trigger_type === "status_change"
      ? fromStatus
        ? { from_status: fromStatus }
        : {}
      : { days: data.days!, status: status! };

  const { error } = await db.from("automation_rules").insert({
    trigger_type: data.trigger_type,
    trigger_value,
    action_channel: data.action_channel,
    action_template_id: data.action_template_id,
  });
  if (error) throw error;

  revalidatePath("/rules");
}

export async function toggleRuleAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";

  const { error } = await supabaseAdmin()
    .from("automation_rules")
    .update({ active: !active })
    .eq("id", id);
  if (error) throw error;

  revalidatePath("/rules");
}

export async function deleteRuleAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const { error } = await supabaseAdmin().from("automation_rules").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/rules");
}
