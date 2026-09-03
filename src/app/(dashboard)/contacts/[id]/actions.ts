"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateContactStatus } from "@/lib/automation-engine";
import { verifyTeamMember } from "@/lib/dal";
import { sendMessageToContact } from "@/lib/send";
import { renderTemplate } from "@/lib/templates";
import { resolveStatus } from "@/lib/statuses";
import { editableFields } from "@/lib/fields";
import { normalizePhone } from "@/lib/quiz";
import type { Database } from "@/lib/supabase/database.types";

// Server Actions are directly callable endpoints, not just page plumbing — verified
// per the Next.js auth guide's guidance, same as any /api route.

export async function changeStatusAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  // רשימת הסטטוסים היא נתונים מאז 0003_statuses.sql — הבדיקה היא מול ה-DB
  const status = await resolveStatus(formData.get("status"));
  if (!contactId || !status) {
    throw new Error("סטטוס לא תקין");
  }

  await updateContactStatus(contactId, status);
  revalidatePath(`/contacts/${contactId}`);
  // אותן פעולות משרתות גם את תיבת הדואר ב-/active.
  revalidatePath("/active");
  revalidatePath("/contacts");
}

/**
 * שמירת שדות הפרטים בכרטיס. השדות והסדר שלהם מוגדרים ב-contact_fields, אז
 * הפעולה לא יכולה להיות רשימה קשיחה — היא עוברת על מה שמוגדר כרגע וקוראת
 * ‎field_<key>‎ לכל אחד. שדות מותאמים נאספים לאובייקט אחד ונכתבים ל-custom.
 */
export async function updateContactFieldsAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  if (!contactId) throw new Error("חסר מזהה איש קשר");

  const db = supabaseAdmin();
  const { data: contact, error: fetchError } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (fetchError) throw fetchError;

  const fields = await editableFields();
  const patch: Database["public"]["Tables"]["contacts"]["Update"] = {};
  const custom: Record<string, string> = { ...(contact.custom ?? {}) };

  for (const field of fields) {
    if (field.key === "status" || field.key === "notes") continue;

    const raw = formData.get(`field_${field.key}`);
    // שדה שלא נשלח בטופס בכלל לא אמור להימחק — רק שדה שנשלח ריק.
    if (raw == null) continue;
    const value = String(raw).trim();

    if (field.kind === "custom") {
      if (value) custom[field.key] = value;
      else delete custom[field.key];
      continue;
    }

    switch (field.key) {
      case "full_name":
        patch.full_name = value || null;
        break;
      case "phone": {
        if (!value) {
          patch.phone = null;
          break;
        }
        // מספר קיים בפורמט ‎+972‎ נשאר כמו שהוא אם לא נגעו בו, כדי שפתיחת
        // הטופס ושמירה לא ישנו מספר שהוואטסאפ כבר מזוהה לפיו.
        if (value === contact.phone) break;
        const normalized = normalizePhone(value);
        if (!normalized) throw new Error(`מספר טלפון לא תקין: ${value}`);
        patch.phone = normalized;
        break;
      }
      case "email": {
        if (!value) {
          patch.email = null;
          break;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new Error(`כתובת מייל לא תקינה: ${value}`);
        }
        patch.email = value.toLowerCase();
        break;
      }
      case "source":
        patch.source = value || "ידני";
        break;
      case "tags":
        patch.tags = value
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      default:
        // שדה מובנה שהוגדר ב-DB בלי טיפול כאן — מתעלמים במקום לכתוב עמודה
        // לא ידועה ולקבל שגיאת PostgREST סתומה.
        break;
    }
  }

  patch.custom = custom;

  const { error } = await db.from("contacts").update(patch).eq("id", contactId);
  if (error) {
    throw new Error(
      error.code === "23505" ? "כבר קיים איש קשר אחר עם הטלפון הזה" : error.message
    );
  }

  revalidatePath(`/contacts/${contactId}`);
  // אותן פעולות משרתות גם את תיבת הדואר ב-/active.
  revalidatePath("/active");
  revalidatePath("/contacts");
}

export async function updateNotesAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const notes = String(formData.get("notes") ?? "");
  if (!contactId) throw new Error("חסר מזהה איש קשר");

  const { error } = await supabaseAdmin().from("contacts").update({ notes }).eq("id", contactId);
  if (error) throw error;

  revalidatePath(`/contacts/${contactId}`);
  // אותן פעולות משרתות גם את תיבת הדואר ב-/active.
  revalidatePath("/active");
}

export async function addManualNoteAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const content = String(formData.get("content") ?? "").trim();
  if (!contactId || !content) return;

  const { error } = await supabaseAdmin().from("interactions").insert({
    contact_id: contactId,
    type: "manual_note",
    content,
  });
  if (error) throw error;

  revalidatePath(`/contacts/${contactId}`);
  // אותן פעולות משרתות גם את תיבת הדואר ב-/active.
  revalidatePath("/active");
}

/**
 * הליבה של שליחת הודעה ידנית מהדשבורד — טקסט חופשי או תבנית מאושרת.
 *
 * מחזירה תוצאה ולא זורקת, וזו לא קפדנות סגנון: ב-Next בפרודקשן טקסט של
 * throw בתוך Server Action נמחק ומוחלף בשגיאה גנרית של React (#441), כך
 * שהסבר עברי מוקפד כמו "איש הקשר מחוץ לחלון 24 השעות" פשוט לא מגיע למי
 * שלחץ. מי שצריך את הנוסח מקבל אותו כערך מוחזר.
 */
type ReplyOutcome = { ok: true } | { ok: false; error: string };

async function performReply(formData: FormData): Promise<ReplyOutcome> {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();

  if (!contactId) return { ok: false, error: "חסר מזהה איש קשר" };
  if (!body && !templateId) return { ok: false, error: "אין מה לשלוח — כתבו הודעה או בחרו תבנית" };

  const db = supabaseAdmin();
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (contactError) return { ok: false, error: contactError.message };

  // הפגישה העתידית הקרובה, כדי ש-{{booking_time}} ודומיו יתמלאו גם בשליחה
  // ידנית ולא רק ממסע. בלי זה תזכורת שנשלחת בלחיצה הייתה יוצאת עם המציין
  // הגולמי.
  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("contact_id", contactId)
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let result;

  if (templateId) {
    const { data: template, error: templateError } = await db
      .from("message_templates")
      .select("*")
      .eq("id", templateId)
      .single();
    if (templateError) return { ok: false, error: templateError.message };
    if (template.channel !== "whatsapp") return { ok: false, error: "זו לא תבנית וואטסאפ" };

    result = await sendMessageToContact({
      contact,
      channel: "whatsapp",
      body: renderTemplate(template.body, contact, booking),
      template,
      booking,
      logPrefix: `[${template.name}]`,
    });
  } else {
    result = await sendMessageToContact({ contact, channel: "whatsapp", body });
  }

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/contacts/${contactId}`);
  // אותן פעולות משרתות גם את שתי הלשוניות של "לקוחות פעילים".
  revalidatePath("/active");
  revalidatePath("/active/sent");

  return { ok: true };
}

/**
 * הגרסה שרכיבי הלקוח קוראים לה (תיבת המענה בשיחה). מחזירה את התוצאה כדי
 * שהשגיאה תוצג ליד תיבת הכתיבה, במקום להפיל את העמוד כולו ל-error.tsx.
 */
export async function sendReplyAction(formData: FormData): Promise<ReplyOutcome> {
  return performReply(formData);
}
