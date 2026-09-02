"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { uploadPublicImage } from "@/lib/media";
import { renderNewsletterHtml } from "@/lib/newsletter";
import { sendEmail } from "@/lib/gmail";
import { clockToMinutes, parseDateKey, zonedTimeToUtc } from "@/lib/booking/timezone";
import type { Contact, Newsletter, NewsletterBlock } from "@/lib/supabase/database.types";

const TIMEZONE = "Asia/Jerusalem";

export type NewsletterResult = { ok: true; id?: string } | { ok: false; error: string };
export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), html: z.string() }),
  z.object({ type: z.literal("image"), url: z.string().url(), alt: z.string() }),
  z.object({
    type: z.literal("youtube"),
    // בדיוק 11 תווים — הפורמט של יוטיוב. חילוץ מקישור נעשה בעורך.
    videoId: z.string().regex(/^[\w-]{11}$/),
    caption: z.string(),
  }),
]);

const draftSchema = z.object({
  subject: z.string().trim().min(1, "חסרה כותרת למייל"),
  blocks: z.array(blockSchema).min(1, "הניוזלטר ריק — צריך לפחות בלוק תוכן אחד"),
  statuses: z.array(z.string()),
  /** ריק = לשלוח עכשיו (כלומר בריצת הקרון הקרובה) */
  date: z.string().optional(),
  time: z.string().optional(),
});

export type NewsletterDraft = z.infer<typeof draftSchema>;

function audienceOf(statuses: string[]) {
  return statuses.length ? { type: "statuses" as const, statuses } : { type: "all" as const };
}

/**
 * מתי לשלוח, כרגע בציר הזמן.
 *
 * תאריך ושעה נקראים כשעון קיר בישראל ולא כ-UTC: מי שכותב 09:00 מתכוון
 * לתשע בבוקר אצלו, ובאוגוסט זה 06:00Z ובינואר 07:00Z.
 */
function scheduledAt(date: string | undefined, time: string | undefined): Date | { error: string } {
  if (!date && !time) return new Date();

  const parsed = date ? parseDateKey(date) : null;
  const minutes = time ? clockToMinutes(time) : null;
  if (!parsed || minutes === null) return { error: "תאריך או שעה לא תקינים" };

  const at = zonedTimeToUtc(parsed.year, parsed.month, parsed.day, minutes, TIMEZONE);
  if (at.getTime() < Date.now()) return { error: "המועד שנבחר כבר עבר" };
  return at;
}

/**
 * יוצרת את הניוזלטר כ-scheduled — גם ב"שלח עכשיו".
 *
 * השליחה בפועל תמיד דרך הקרון (src/lib/newsletter-engine.ts): 200 שליחות
 * דרך Gmail לא נכנסות בטיימאאוט של בקשה אחת, ושליחה שנקטעת באמצע בלי שורות
 * נמענים היא שליחה שאי אפשר להמשיך.
 */
export async function createNewsletterAction(input: NewsletterDraft): Promise<NewsletterResult> {
  await verifyTeamMember();

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const when = scheduledAt(parsed.data.date, parsed.data.time);
  if ("error" in when) return { ok: false, error: when.error };

  const { data, error } = await supabaseAdmin()
    .from("newsletters")
    .insert({
      subject: parsed.data.subject,
      blocks: parsed.data.blocks as NewsletterBlock[],
      audience: audienceOf(parsed.data.statuses),
      status: "scheduled",
      scheduled_at: when.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return {
        ok: false,
        error:
          "טבלאות הניוזלטר לא קיימות. יש להריץ את supabase/migrations/0022_newsletters.sql ב-SQL editor של Supabase.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/newsletter/scheduled");
  revalidatePath("/");
  return { ok: true, id: data.id };
}

/**
 * איש קשר בדוי לתצוגה מקדימה. המזהה מאופס בכוונה: קישור ההסרה שייחתם עבורו
 * תקף מבחינה קריפטוגרפית אבל לא מצביע על אף אחד, ולכן לחיצה עליו במייל
 * הבדיקה לא תסיר איש קשר אמיתי מהתפוצה (הראוט מחזיר "הקישור אינו תקין").
 */
function previewContact(email: string): Contact {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-0000-0000-000000000000",
    full_name: "ישראלה ישראלי",
    phone: "0500000000",
    email,
    status: "ליד_חדש",
    source: "preview",
    tags: [],
    whatsapp_id: null,
    last_incoming_message_at: null,
    unsubscribed_at: null,
    notes: null,
    custom: {},
    created_at: now,
    updated_at: now,
  };
}

/**
 * שולחת את המייל המרונדר לחבר הצוות המחובר בלבד.
 *
 * ── למה לא דרך sendMessageToContact ──
 * הכלל "כל שליחה עוברת דרך send.ts" קיים כדי ששום הודעה ל*לקוח* לא תצא בלי
 * שתירשם ביומן ובלי שתיכפף לבלמים. כאן אין לקוח: הנמען הוא בעל המערכת,
 * הנמענת המוצגת בדוגמה בדויה, ואין שורת איש קשר שאפשר או ראוי לרשום עליה
 * את השליחה. רישום כזה היה מזהם את היומן של מישהו אחר.
 */
export async function sendDraftToSelfAction(input: NewsletterDraft): Promise<NewsletterResult> {
  const { email } = await verifyTeamMember();
  if (!email) return { ok: false, error: "אין כתובת מייל למשתמש המחובר" };

  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "הטופס אינו תקין" };
  }

  const draft: Newsletter = {
    id: "00000000-0000-0000-0000-000000000000",
    subject: parsed.data.subject,
    blocks: parsed.data.blocks as NewsletterBlock[],
    audience: audienceOf(parsed.data.statuses),
    status: "draft",
    scheduled_at: null,
    sent_count: 0,
    failed_count: 0,
    created_at: new Date().toISOString(),
  };

  try {
    await sendEmail({
      to: email,
      subject: `[טיוטה] ${parsed.data.subject}`,
      html: renderNewsletterHtml(draft, previewContact(email)),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true };
}

export async function uploadNewsletterImageAction(formData: FormData): Promise<UploadResult> {
  await verifyTeamMember();

  const file = formData.get("image");
  if (!(file instanceof File)) return { ok: false, error: "לא נבחר קובץ" };

  try {
    return { ok: true, url: await uploadPublicImage(file, "newsletter") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** ביטול זמין רק כל עוד השליחה לא התחילה — אי אפשר לבטל מייל שכבר יצא. */
export async function cancelNewsletterAction(formData: FormData): Promise<void> {
  await verifyTeamMember();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await supabaseAdmin()
    .from("newsletters")
    .update({ status: "canceled" })
    .eq("id", id)
    .eq("status", "scheduled");

  revalidatePath("/newsletter/scheduled");
  revalidatePath("/");
}
