import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { sendDynamicReply, sendFlow, isWithin24HourWindow } from "./manychat";
import { sendEmail } from "./gmail";
import type { Contact, MessageChannel } from "./supabase/database.types";

// The one place that actually sends a message to a contact and logs it — shared by
// the automation engine (src/lib/automation-engine.ts, rule-driven) and the manual
// "send" API routes (dashboard-driven, ad-hoc). Picking the channel logic apart from
// rule-matching logic keeps both callers honest: neither can drift into re-sending
// without logging, or logging without actually sending.

export interface SendMessageInput {
  contact: Contact;
  channel: MessageChannel;
  /** Required for email; ignored for whatsapp. */
  subject?: string;
  /** Rendered message body — HTML for email, plain text for WhatsApp. */
  body: string;
  /** WhatsApp only: ManyChat Flow namespace to use if the contact is outside the 24h window. */
  manychatFlowNs?: string | null;
  /** Prefixed onto the logged interactions.content, e.g. "[תבנית מעקב יום 3] ". */
  logPrefix?: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendMessageToContact(input: SendMessageInput): Promise<SendResult> {
  const db = supabaseAdmin();
  const label = input.logPrefix ? `${input.logPrefix} ` : "";

  try {
    if (input.channel === "email") {
      if (!input.contact.email) {
        throw new Error("לאיש הקשר אין כתובת מייל");
      }
      if (!input.subject) {
        throw new Error("חסרה כותרת (subject) למייל");
      }

      await sendEmail({ to: input.contact.email, subject: input.subject, html: input.body });

      const { error } = await db.from("interactions").insert({
        contact_id: input.contact.id,
        type: "email_out",
        content: `${label}${input.subject}`,
      });
      if (error) throw error;
    } else {
      if (!input.contact.manychat_subscriber_id) {
        throw new Error(
          "לאיש הקשר אין manychat_subscriber_id (עדיין לא התקבלה הודעה דרכו ב-webhook)"
        );
      }

      if (isWithin24HourWindow(input.contact.last_incoming_message_at)) {
        await sendDynamicReply(input.contact.manychat_subscriber_id, input.body);
      } else {
        if (!input.manychatFlowNs) {
          throw new Error(
            "מחוץ לחלון 24 השעות, וללא flow_ns של פלואו עם תבנית מאושרת אי אפשר לשלוח"
          );
        }
        await sendFlow(input.contact.manychat_subscriber_id, input.manychatFlowNs);
      }

      const { error } = await db.from("interactions").insert({
        contact_id: input.contact.id,
        type: "manychat_out",
        content: `${label}${input.body}`,
      });
      if (error) throw error;
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
