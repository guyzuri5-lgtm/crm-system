"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { waIdFromPhone } from "@/lib/whatsapp-cloud";
import {
  isBridgeConfigured,
  requestPairingCode,
  sendBridgeTestToSelf,
} from "@/lib/whatsapp-bridge";

/**
 * הפעולות של דף הוואטסאפ.
 *
 * כולן מחזירות תוצאה ולא זורקות: שגיאה שנזרקת מ-Server Action מגיעה למשתמש
 * בפרודקשן כ-"React #441" בלי הנוסח העברי. הדף מציג את ההודעה ליד הכפתור.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

const brakesSchema = z
  .object({
    whatsapp_paused: z.boolean(),
    daily_limit: z.coerce.number().int().min(1, "התקרה היומית חייבת להיות לפחות 1").max(1000),
    min_gap_seconds: z.coerce.number().int().min(0).max(600),
    max_gap_seconds: z.coerce.number().int().min(0).max(600),
    warmup_enabled: z.boolean(),
    quiet_hours_enabled: z.boolean(),
    quiet_start_hour: z.coerce.number().int().min(0).max(23),
    quiet_end_hour: z.coerce.number().int().min(0).max(23),
    quiet_shabbat: z.boolean(),
  })
  .refine((v) => v.max_gap_seconds >= v.min_gap_seconds, {
    message: "הרווח המקסימלי חייב להיות גדול או שווה לרווח המינימלי",
  });

export async function saveWhatsAppBrakesAction(formData: FormData): Promise<ActionResult> {
  await verifyTeamMember();

  const parsed = brakesSchema.safeParse({
    whatsapp_paused: formData.get("whatsapp_paused") === "on",
    daily_limit: formData.get("daily_limit"),
    min_gap_seconds: formData.get("min_gap_seconds"),
    max_gap_seconds: formData.get("max_gap_seconds"),
    warmup_enabled: formData.get("warmup_enabled") === "on",
    quiet_hours_enabled: formData.get("quiet_hours_enabled") === "on",
    quiet_start_hour: formData.get("quiet_start_hour") ?? 21,
    quiet_end_hour: formData.get("quiet_end_hour") ?? 8,
    quiet_shabbat: formData.get("quiet_shabbat") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  const db = supabaseAdmin();

  // הדלקה מחדש של החימום מתחילה אותו מהיום, ולא ממשיכה מאיפה שעצר.
  const { data: current } = await db
    .from("whatsapp_settings")
    .select("warmup_enabled")
    .maybeSingle();
  const restartWarmup = parsed.data.warmup_enabled && current?.warmup_enabled === false;

  const { error } = await db
    .from("whatsapp_settings")
    .update({
      ...parsed.data,
      ...(restartWarmup ? { warmup_started_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    // 42703 / PGRST204 = העמודה חסרה, כלומר 0058 עוד לא הודבקה.
    if (error.code === "42703" || error.code === "PGRST204") {
      return {
        ok: false,
        error:
          "חסרות עמודות במסד. יש להדביק את supabase/migrations/0058_whatsapp_bridge_brakes.sql ואת 0059_whatsapp_optout_quiet_alert.sql ב-SQL Editor של Supabase.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/whatsapp");
  return { ok: true };
}

export async function requestPairingCodeAction(
  phone: string
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  await verifyTeamMember();
  if (!isBridgeConfigured()) return { ok: false, error: "הגשר לא מוגדר בוורסל" };

  const waId = waIdFromPhone(phone);
  if (!waId) return { ok: false, error: "המספר לא תקין. למשל: 055-269-0416" };

  try {
    return { ok: true, code: await requestPairingCode(waId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendTestToSelfAction(): Promise<ActionResult> {
  await verifyTeamMember();
  if (!isBridgeConfigured()) return { ok: false, error: "הגשר לא מוגדר בוורסל" };

  try {
    const time = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    await sendBridgeTestToSelf(`הודעת בדיקה מה-CRM (${time}). אם היא הגיעה, הגשר עובד.`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
