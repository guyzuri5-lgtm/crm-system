import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import {
  isWithin24HourWindow,
  sendTemplate,
  sendText,
  waIdFromPhone,
} from "./whatsapp-cloud";
import { renderTemplate } from "./templates";
import { sendEmail } from "./gmail";
import type { Contact, MessageChannel, MessageTemplate } from "./supabase/database.types";

// המקום היחיד ששולח בפועל הודעה לאיש קשר ורושם אותה ביומן — משותף למנוע
// הכללים (src/lib/automation-engine.ts) ולראוטים הידניים של השליחה מהדשבורד.
// ההפרדה בין בחירת הערוץ לבין התאמת הכללים היא מה ששומר על שני הקוראים כנים:
// אף אחד מהם לא יכול לשלוח בלי לרשום, או לרשום בלי לשלוח.

export interface SendMessageInput {
  contact: Contact;
  channel: MessageChannel;
  /** חובה למייל, מתעלמים ממנו בוואטסאפ. */
  subject?: string;
  /** גוף ההודעה המרונדר — HTML למייל, טקסט רגיל לוואטסאפ. */
  body: string;
  /**
   * וואטסאפ בלבד: התבנית המאושרת שתישלח אם חלון 24 השעות סגור.
   *
   * לא מספיק להעביר טקסט: מחוץ לחלון Meta מקבלת *רק* תבנית שאושרה מראש, לפי
   * שם ושפה. בלי תבנית כזו אין דרך חוקית לפנות ללקוח שלא כתב לנו לאחרונה.
   */
  template?: MessageTemplate | null;
  /** קידומת לתוכן שנרשם ב-interactions, למשל "[תבנית מעקב יום 3] ". */
  logPrefix?: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };

export async function sendMessageToContact(input: SendMessageInput): Promise<SendResult> {
  const db = supabaseAdmin();
  const label = input.logPrefix ? `${input.logPrefix} ` : "";

  try {
    if (input.channel === "email") {
      if (!input.contact.email) throw new Error("לאיש הקשר אין כתובת מייל");
      if (!input.subject) throw new Error("חסרה כותרת (subject) למייל");

      await sendEmail({ to: input.contact.email, subject: input.subject, html: input.body });

      const { error } = await db.from("interactions").insert({
        contact_id: input.contact.id,
        type: "email_out",
        content: `${label}${input.subject}`,
      });
      if (error) throw error;

      return { ok: true };
    }

    // ה-wa_id השמור קודם, ורק אז גזירה מהטלפון: מה שהתקבל בפועל מ-Meta אמין
    // יותר מהמרה של מספר שמישהו הקליד.
    const waId = input.contact.whatsapp_id ?? waIdFromPhone(input.contact.phone);
    if (!waId) {
      throw new Error(
        "לאיש הקשר אין מספר טלפון תקין לוואטסאפ (ולא התקבלה ממנו הודעה שממנה אפשר לגזור אותו)"
      );
    }

    const openWindow = isWithin24HourWindow(input.contact.last_incoming_message_at);

    let messageId: string | null;
    let logged: string;

    if (openWindow) {
      // בתוך החלון הכול מותר, וזה גם חינם.
      messageId = await sendText(waId, input.body);
      logged = input.body;
    } else {
      const template = input.template;
      if (!template?.meta_template_name) {
        throw new Error(
          "איש הקשר מחוץ לחלון 24 השעות — אפשר לשלוח לו רק תבנית שאושרה ב-Meta, ולא טקסט חופשי"
        );
      }

      // הפרמטרים נגזרים מאותם מציינים של גוף ההודעה ({{first_name}}), כדי
      // שיהיה מודל מנטלי אחד למי שכותב תבנית ולא שתי שפות מציינים.
      const parameters = template.meta_variables.map((expression) =>
        renderTemplate(expression, input.contact)
      );

      messageId = await sendTemplate({
        waId,
        name: template.meta_template_name,
        languageCode: template.meta_language_code,
        parameters,
      });

      // נרשם הטקסט המרונדר ולא שם התבנית: מי שקורא את היומן רוצה לדעת מה
      // הלקוח קיבל, לא איזו ישות ב-Meta שלחה את זה.
      logged = input.body;
    }

    const { error } = await db.from("interactions").insert({
      contact_id: input.contact.id,
      type: "whatsapp_out",
      content: `${label}${logged}`,
      // ה-wamid הוא מה שמחבר את ההודעה לעדכון המסירה שיגיע אחריה ב-webhook,
      // ומה שמונע רישום כפול אם אותו webhook יישלח שוב.
      external_id: messageId,
    });
    if (error) throw error;

    // איש קשר שנוצר ידנית או מייבוא אקסל מגיע בלי wa_id. אחרי שליחה מוצלחת
    // אנחנו יודעים אותו בוודאות, וזה חוסך את חיפוש הטלפון בפעם הבאה.
    if (!input.contact.whatsapp_id) {
      await db.from("contacts").update({ whatsapp_id: waId }).eq("id", input.contact.id);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
