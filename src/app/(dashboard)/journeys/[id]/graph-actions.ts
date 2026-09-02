"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  JOURNEY_CONDITIONS,
  MESSAGE_CHANNELS,
  STEP_TIMINGS,
} from "@/lib/supabase/database.types";

/**
 * עריכת הגרף מהמשטח.
 *
 * הפעולות כאן נפרדות מ-actions.ts של המסע עצמו, כי הן נקראות מרכיב לקוח תוך
 * כדי גרירה — כלומר בתדירות גבוהה ובלי ניווט. הן מכוונות להיות זולות: כל
 * אחת נוגעת בשורה אחת ומחזירה כלום.
 */

const idSchema = z.string().uuid();

/**
 * הערוץ של כרטיסייה אינו נבחר בטופס אלא נגזר כאן מהתבנית.
 *
 * בטופס הישן היו שני שדות נפרדים, ואפשר היה לבחור תבנית מייל עם ערוץ
 * וואטסאפ — שילוב שנראה תקין על המסך ונכשל רק בשליחה. גזירה בשרת הופכת
 * את אי-ההתאמה לבלתי אפשרית, גם אם הטופס ישתבש.
 */
async function channelOfTemplate(templateId: string) {
  const { data, error } = await supabaseAdmin()
    .from("message_templates")
    .select("channel")
    .eq("id", templateId)
    .single();
  if (error) throw error;

  const parsed = z.enum(MESSAGE_CHANNELS).safeParse(data.channel);
  if (!parsed.success) throw new Error("לתבנית שנבחרה אין ערוץ מוכר");
  return parsed.data;
}

// ── צמתים ──────────────────────────────────────────────────────────────────

const addStepSchema = z.object({
  journey_id: idSchema,
  template_id: idSchema,
  wait_days: z.coerce.number().int().min(0).max(365),
  offset_minutes: z.coerce.number().int().min(-43200).max(43200),
  timing: z.enum(STEP_TIMINGS),
  day_offset: z.coerce.number().int().min(-30).max(30),
  day_at_minutes: z.coerce.number().int().min(0).max(1439),
  label: z.string().trim().max(60).optional(),
  pos_x: z.coerce.number().int(),
  pos_y: z.coerce.number().int(),
});

export async function addNodeAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = addStepSchema.safeParse({
    journey_id: formData.get("journey_id"),
    template_id: formData.get("template_id"),
    wait_days: formData.get("wait_days") || 0,
    offset_minutes: formData.get("offset_minutes") || 0,
    timing: formData.get("timing") || "relative",
    day_offset: formData.get("day_offset") || 0,
    day_at_minutes: formData.get("day_at_minutes") || 540,
    label: formData.get("label") || undefined,
    pos_x: formData.get("pos_x") || 0,
    pos_y: formData.get("pos_y") || 0,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

  const db = supabaseAdmin();
  const channel = await channelOfTemplate(parsed.data.template_id);
  const { data: step, error } = await db
    .from("journey_steps")
    .insert({ ...parsed.data, channel, label: parsed.data.label ?? null })
    .select("id")
    .single();
  if (error) throw error;

  // צומת ראשון במסע מתחבר אוטומטית לכניסה. בלי זה מסע חדש נראה שלם על
  // המסך אבל לא מצרף איש, וזו תקלה שקשה לראות: הכרטיסייה שם, פשוט אף אחד
  // לא מגיע אליה.
  const { count } = await db
    .from("journey_steps")
    .select("id", { count: "exact", head: true })
    .eq("journey_id", parsed.data.journey_id);

  if (count === 1) {
    await db.from("journey_edges").insert({
      journey_id: parsed.data.journey_id,
      from_step_id: null,
      to_step_id: step.id,
    });
  }

  revalidatePath(`/journeys/${parsed.data.journey_id}`);

  // ה-id חוזר כדי שהמשטח יוכל לפתוח את הכרטיסייה החדשה מסומנת מיד.
  return { id: step.id as string };
}

/**
 * עדכון כרטיסייה קיימת מתוך המשטח.
 *
 * אותה סכימה של ההוספה, בלי המיקום: המיקום מתעדכן בגרירה ולא בטופס, ושליחתו
 * כאן הייתה מחזירה את הכרטיסייה למקום שהיה בה כשהפאנל נפתח.
 */
const updateStepSchema = addStepSchema.omit({ journey_id: true, pos_x: true, pos_y: true });

export async function updateNodeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");
  if (!id) return;

  const parsed = updateStepSchema.safeParse({
    template_id: formData.get("template_id"),
    wait_days: formData.get("wait_days") || 0,
    offset_minutes: formData.get("offset_minutes") || 0,
    timing: formData.get("timing") || "relative",
    day_offset: formData.get("day_offset") || 0,
    day_at_minutes: formData.get("day_at_minutes") || 540,
    label: formData.get("label") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(", "));

  const channel = await channelOfTemplate(parsed.data.template_id);
  const { error } = await supabaseAdmin()
    .from("journey_steps")
    .update({ ...parsed.data, channel, label: parsed.data.label ?? null })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

export async function deleteNodeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");

  // הקשתות יורדות ב-cascade משני הכיוונים. צירופים שעמדו על הצומת מקבלים
  // current_step_id ריק, והמנוע מסיים אותם בריצה הבאה.
  const { error } = await supabaseAdmin().from("journey_steps").delete().eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

/**
 * שמירת מיקום אחרי גרירה.
 *
 * נקראת בסיום הגרירה ולא תוך כדי: עדכון לכל פיקסל היה מציף את המסד בכתיבות
 * שכולן חוץ מהאחרונה חסרות ערך.
 */
export async function moveNodeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");
  const x = Number(formData.get("pos_x"));
  const y = Number(formData.get("pos_y"));
  if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;

  const { error } = await supabaseAdmin()
    .from("journey_steps")
    .update({ pos_x: Math.round(x), pos_y: Math.round(y) })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

// ── קשתות ──────────────────────────────────────────────────────────────────

export async function addEdgeAction(formData: FormData) {
  await verifyTeamMember();

  const journeyId = String(formData.get("journey_id") ?? "");
  const rawFrom = String(formData.get("from_step_id") ?? "");
  const from = rawFrom === "entry" || rawFrom === "" ? null : rawFrom;
  const to = String(formData.get("to_step_id") ?? "");

  if (!journeyId || !to) return;
  if (from === to) throw new Error("אי אפשר לחבר כרטיסייה לעצמה");

  const db = supabaseAdmin();

  // חיבור כפול בין אותם שני צמתים אינו שגיאה במסד, אבל הוא חסר משמעות:
  // הקשת השנייה לעולם לא תיבחר, כי הראשונה שמתאימה זוכה.
  //
  // ‎is(null)‎ ו-‎eq(id)‎ הם שני מסננים שונים ב-PostgREST, ולכן שני ענפים ולא
  // ביטוי אחד עם undefined — שהיה נופל בין הכיסאות ומסנן כלום.
  const base = db.from("journey_edges").select("id").eq("journey_id", journeyId);
  const { data: duplicates } =
    from === null
      ? await base.eq("to_step_id", to).is("from_step_id", null)
      : await base.eq("to_step_id", to).eq("from_step_id", from);

  if ((duplicates ?? []).length) return;

  const counter = db
    .from("journey_edges")
    .select("id", { count: "exact", head: true })
    .eq("journey_id", journeyId);
  const { count } =
    from === null ? await counter.is("from_step_id", null) : await counter.eq("from_step_id", from);

  const { error } = await db.from("journey_edges").insert({
    journey_id: journeyId,
    from_step_id: from,
    to_step_id: to,
    priority: count ?? 0,
  });
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

export async function deleteEdgeAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");

  const { error } = await supabaseAdmin().from("journey_edges").delete().eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}

export async function setEdgeConditionAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  const journeyId = String(formData.get("journey_id") ?? "");
  const parsed = z.enum(JOURNEY_CONDITIONS).safeParse(formData.get("condition"));
  if (!parsed.success) throw new Error("תנאי לא מוכר");

  const { error } = await supabaseAdmin()
    .from("journey_edges")
    .update({ condition: parsed.data })
    .eq("id", id);
  if (error) throw error;

  revalidatePath(`/journeys/${journeyId}`);
}
