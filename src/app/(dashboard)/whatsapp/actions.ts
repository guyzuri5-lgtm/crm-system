"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";

const settingsSchema = z.object({
  daily_limit: z.coerce.number().int().min(1).max(5000),
  paused: z.coerce.boolean(),
});

export async function saveWhatsAppSettingsAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = settingsSchema.safeParse({
    daily_limit: formData.get("daily_limit"),
    paused: formData.get("paused") === "on",
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(", "));
  }

  const { error } = await supabaseAdmin()
    .from("whatsapp_settings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    // הטבלה נוצרת ב-0010. ההודעה הגולמית של PostgREST לא אומרת מה חסר.
    if (error.code === "42P01" || error.code === "PGRST205") {
      throw new Error(
        "טבלת ההגדרות לא קיימת. יש להריץ את supabase/migrations/0011_whatsapp_cloud_api.sql ב-SQL editor של Supabase."
      );
    }
    throw error;
  }

  revalidatePath("/whatsapp");
}
