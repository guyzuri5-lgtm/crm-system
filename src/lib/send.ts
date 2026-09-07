import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import {
  isWithin24HourWindow,
  sendTemplate,
  sendText,
  waIdFromPhone,
} from "./whatsapp-cloud";
import { renderTemplate, unresolvedPlaceholders } from "./templates";
import {
  looksLikeHtml,
  plainTextToEmailHtml,
  sendEmail,
  type MessageStream,
} from "./email";
import type {
  Contact,
  MessageChannel,
  MessageTemplate,
  Booking,
  EventRow,
} from "./supabase/database.types";

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
  /**
   * מייל בלבד: תפעולי או דיוור.
   *
   * ברירת המחדל תפעולית, וזה הנכון כמעט תמיד — הודעה אחת לאדם אחד. רק
   * הניוזלטר מבקש broadcast, ו-Postmark דורש את ההפרדה הזו (טווחי IP נפרדים,
   * כך שתלונה על דיוור לא פוגעת במסירה של אישור פגישה).
   */
  stream?: MessageStream;
  /** מייל בלבד: כתובת ההסרה, לכותרת List-Unsubscribe. חובה בפועל לדיוור. */
  listUnsubscribeUrl?: string;
  /**
   * הפגישה שההודעה מדברת עליה, אם יש.
   *
   * נדרשת גם כאן ולא רק ברינדור הגוף: מציין כמו {{booking_time}} יכול לשבת
   * גם בתוך meta_variables, כלומר להיות אחד מהערכים שממלאים את {{1}} בתבנית
   * המאושרת. בלי להעביר אותה לכאן, תזכורת ששולחת את השעה הייתה יוצאת מחוץ
   * לחלון 24 השעות עם המציין הגולמי במקום המועד.
   */
  booking?: Booking | null;
  /**
   * האירוע שההודעה מדברת עליו, אם יש — נוסף ב-0027 לתזכורות האירועים.
   *
   * נדרש כאן מאותה סיבה בדיוק כמו booking: מציין כמו {{event_time}} יכול
   * לשבת בתוך meta_variables, כלומר להיות אחד מהערכים שממלאים את {{1}}
   * בתבנית המאושרת. בלי להעביר אותו לכאן, תזכורת שיוצאת מחוץ לחלון 24
   * השעות הייתה מגיעה עם המציין הגולמי במקום עם המועד.
   */
  event?: EventRow | null;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * הודעה שנשארו בה מציינים לא פתורים לא יוצאת.
 *
 * renderTemplate משאיר מציין בלי הקשר כפי שהוא, מתוך הנחה שמישהו יראה את
 * ההודעה השבורה. אף אחד לא רואה: הטקסט המרונדר הולך ישר ללקוח. ב-5.9.2026
 * יצאה בפועל תזכורת עם "ב{{booking_day}} בשעה {{booking_time}}" בגוף.
 *
 * הבדיקה כאן ולא אצל הקוראים, כי יש ארבעה מהם — שליחה ידנית, מסעות, כללים
 * ותזכורות אירועים — ובדיקה שמשוכפלת ארבע פעמים היא בדיקה שתישכח באחת מהן.
 *
 * זו ולידציה דרך אי-אפשרות: הכישלון מפורש, מוסבר, ומגיע למי ששלח — במקום
 * הודעה שגויה שמגיעה למי שלא אמור היה לראות אותה.
 */
function assertNoUnresolvedPlaceholders(rendered: string, where: string): void {
  const missing = unresolvedPlaceholders(rendered);
  if (!missing.length) return;

  const list = missing.map((key) => `{{${key}}}`).join(", ");
  throw new Error(
    `ההודעה לא נשלחה: ${where} מכיל מציינים שלא הוחלפו — ${list}. ` +
      `מציני פגישה מתמלאים רק כשלאיש הקשר יש פגישה עתידית, ומציני אירוע רק בתזכורת של אירוע.`
  );
}

export async function sendMessageToContact(input: SendMessageInput): Promise<SendResult> {
  const db = supabaseAdmin();
  const label = input.logPrefix ? `${input.logPrefix} ` : "";

  try {
    assertNoUnresolvedPlaceholders(input.body, "גוף ההודעה");
    if (input.subject) assertNoUnresolvedPlaceholders(input.subject, "כותרת המייל");

    if (input.channel === "email") {
      if (!input.contact.email) throw new Error("לאיש הקשר אין כתובת מייל");
      if (!input.subject) throw new Error("חסרה כותרת (subject) למייל");

      // ── טקסט רגיל נעטף, HTML עובר כמו שהוא ──
      //
      // רוב הקוראים כאן שולחים גוף של תבנית, כלומר טקסט שנכתב בתיבת טקסט
      // עם פסקאות. הוא נמסר ל-Postmark כ-HtmlBody, ושם ירידת שורה היא
      // רווח — ולכן הגיע ללקוחה כגוש רצוף (קרה בפועל ב-7.9.2026, במייל
      // הראשון ללקוחה משלמת). מי שכבר בונה HTML מלא — הניוזלטר ודוח
      // השאלון — מזוהה לפי תגית ועובר בלי שינוי.
      //
      // ההחלטה כאן ולא אצל הקוראים, כי יש שישה מהם: מסעות, כללים, תזכורות
      // אירוע, הראוט הידני, הדוח והניוזלטר. תיקון שמשוכפל שש פעמים הוא
      // תיקון שיישכח באחת מהן.
      await sendEmail({
        to: input.contact.email,
        subject: input.subject,
        html: looksLikeHtml(input.body) ? input.body : plainTextToEmailHtml(input.body),
        stream: input.stream,
        listUnsubscribeUrl: input.listUnsubscribeUrl,
      });

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
        renderTemplate(expression, input.contact, input.booking, input.event)
      );

      // הפרמטרים נבדקים בנפרד מהגוף. הם נשלחים למטא כערכים של {{1}}, {{2}}
      // וכו', והיא מציגה אותם ללקוח כפי שהם — כלומר מציין שלא הוחלף כאן
      // מגיע אליו כטקסט "{{booking_time}}" בתוך הודעה מאושרת. זה מסלול
      // נפרד לחלוטין מגוף ההודעה, ולכן בדיקה אחת לא מכסה את שניהם.
      parameters.forEach((value, index) =>
        assertNoUnresolvedPlaceholders(value, `הפרמטר ${index + 1} של התבנית המאושרת`)
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
