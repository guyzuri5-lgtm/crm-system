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
        // מספר קיים בפורמט ‎+972‎ נשאר כמו שהוא אם לא נגעו בו, כדי לא לנתק
        // את איש הקשר מ-ManyChat רק בגלל שמישהו פתח את הטופס ושמר.
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
}

// Free-form reply, typed by a team member — only valid inside the 24h window (see
// isWithin24HourWindow in src/lib/manychat.ts). sendMessageToContact enforces that
// itself; if called outside the window it fails with a clear error rather than
// silently doing nothing, which the dashboard's error.tsx surfaces to whoever sent it.
export async function sendWhatsAppReplyAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) throw new Error("חסר תוכן להודעה");

  const db = supabaseAdmin();
  const { data: contact, error } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (error) throw error;

  const result = await sendMessageToContact({ contact, channel: "whatsapp", body });
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/contacts/${contactId}`);
}

// Outside the 24h window, WhatsApp requires a Meta-approved template — sent via the
// ManyChat Flow recorded on the template (manychat_template_id = flow_ns), not free text.
export async function sendWhatsAppTemplateAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const templateId = String(formData.get("template_id") ?? "");
  if (!contactId || !templateId) throw new Error("חסרים פרטים לשליחת התבנית");

  const db = supabaseAdmin();
  const [{ data: contact, error: contactError }, { data: template, error: templateError }] =
    await Promise.all([
      db.from("contacts").select("*").eq("id", contactId).single(),
      db.from("message_templates").select("*").eq("id", templateId).single(),
    ]);
  if (contactError) throw contactError;
  if (templateError) throw templateError;
  if (template.channel !== "whatsapp") throw new Error("זו לא תבנית וואטסאפ");

  const result = await sendMessageToContact({
    contact,
    channel: "whatsapp",
    body: renderTemplate(template.body, contact),
    manychatFlowNs: template.manychat_template_id,
    logPrefix: `[${template.name}]`,
  });
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/contacts/${contactId}`);
}
