"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateContactStatus } from "@/lib/automation-engine";
import { verifyTeamMember } from "@/lib/dal";
import { sendMessageToContact } from "@/lib/send";
import { renderTemplate } from "@/lib/templates";
import { CONTACT_STATUSES, type ContactStatus } from "@/lib/supabase/database.types";

// Server Actions are directly callable endpoints, not just page plumbing — verified
// per the Next.js auth guide's guidance, same as any /api route.

function isContactStatus(value: string): value is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(value);
}

export async function changeStatusAction(formData: FormData) {
  await verifyTeamMember();

  const contactId = String(formData.get("contact_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!contactId || !isContactStatus(status)) {
    throw new Error("סטטוס לא תקין");
  }

  await updateContactStatus(contactId, status);
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
