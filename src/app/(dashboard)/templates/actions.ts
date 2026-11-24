"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listTemplateBlockers } from "./blockers";

/**
 * תבנית — וואטסאפ או מייל.
 *
 * עד 24.11.2026 תבנית וואטסאפ נוצרה רק דרך מטא, כי מחוץ לחלון 24 השעות מטא
 * מתירה רק נוסח שאישרה. מאז הוואטסאפ יוצא דרך הגשר (src/lib/whatsapp-bridge.ts),
 * שאין בו חלון ואין אישור — תבנית היא פשוט טקסט עם מציינים.
 *
 * בוואטסאפ אפשר לכתוב כמה גרסאות לאותה הודעה, מופרדות בשורה של שלושה מקפים
 * (---). בכל שליחה נבחרת אחת באקראי (ר' pickVariant ב-src/lib/templates.ts),
 * כדי שלא ייצאו עשרות הודעות זהות — החתימה הכי ברורה של בוט.
 */
const createTemplateSchema = z.object({
  name: z.string().min(1, "חובה למלא שם לתבנית"),
  channel: z.enum(["whatsapp", "email"]),
  subject: z.string().optional(),
  body: z.string().min(1, "חובה למלא תוכן"),
});

export async function createTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createTemplateSchema.safeParse({
    name: formData.get("name"),
    channel: formData.get("channel") || "whatsapp",
    subject: formData.get("subject") || undefined,
    body: formData.get("body"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }

  const { error } = await supabaseAdmin()
    .from("message_templates")
    .insert({
      name: parsed.data.name,
      channel: parsed.data.channel,
      body: parsed.data.body,
      // לוואטסאפ אין כותרת. גם אם מולאה בטעות לפני שהוחלף הערוץ — לא נשמרת.
      subject: parsed.data.channel === "email" ? (parsed.data.subject ?? null) : null,
    });
  if (error) throw error;

  revalidatePath("/templates");
}

/**
 * מחיקה — ובעיקר, מה קורה כשהיא חסומה.
 *
 * קודם נזרקה כאן שגיאה עם הסבר בעברית, והיא לא הגיעה לאיש: Next מסתירה
 * בפרודקשן את הטקסט של שגיאה שנזרקת מ-Server Action ומחליפה אותו בגנרית של
 * React ("Minified React error #441"). ההסבר היה נכון ובלתי נראה.
 *
 * לכן הבדיקה נעשית מראש, והחסימה מוחזרת כניווט ולא כשגיאה. ב-URL נוסע רק
 * המזהה — את הנוסח מרכיב העמוד מהנתונים החיים, כך שאין טקסט חופשי שעובר
 * דרך שורת הכתובת ואין הודעה שמתיישנת מול המצב במסד.
 */
export async function deleteTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");

  const blockers = await listTemplateBlockers();
  if (blockers.has(id)) redirect(`/templates?blocked=${id}`);

  const { error } = await supabaseAdmin().from("message_templates").delete().eq("id", id);
  if (error) {
    // 23503 = הפרת מפתח זר. אחרי הבדיקה שלמעלה זה אומר שמסע או כלל נוצרו
    // בין הבדיקה למחיקה — נדיר, אבל התשובה זהה.
    if (error.code === "23503") redirect(`/templates?blocked=${id}`);
    throw error;
  }

  revalidatePath("/templates");
}
