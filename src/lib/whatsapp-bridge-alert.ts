import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { sendEmail } from "./email";
import { getWhatsAppSettings } from "./whatsapp-throttle";
import { getBridgeStatus, isBridgeConfigured } from "./whatsapp-bridge";

/**
 * מייל לגיא כשהגשר מנותק או לא עונה. רץ בכל ריצה של הקרון.
 *
 * ── למה זה נחוץ ──
 * גשר מנותק לא צועק. המסעות ממשיכים לרוץ, כל שליחה נכשלת בשקט, ובלי התראה
 * מגלים את זה אחרי ימים — כשלקוח שואל למה לא קיבל תזכורת. מכשיר מקושר
 * מתנתק כשהטלפון לא היה מחובר לאינטרנט כ-14 יום, או כשמסירים אותו ידנית.
 *
 * מייל אחד כל 12 שעות לכל היותר, ולא בכל ריצה. החותמת מתאפסת כשהגשר חוזר,
 * כך שניתוק חדש אחר כך יתריע מיד.
 *
 * הנמען: ALERT_EMAIL, ואם אין — POSTMARK_REPLY_TO (התיבה של העסק).
 */

const REALERT_MS = 12 * 60 * 60 * 1000;

export type BridgeAlertResult =
  | "not_configured"
  | "healthy"
  | "alerted"
  | "already_alerted"
  | "no_recipient"
  | "failed";

export async function checkBridgeAndAlert(now: Date = new Date()): Promise<BridgeAlertResult> {
  if (!isBridgeConfigured()) return "not_configured";

  let problem: string | null = null;
  try {
    const status = await getBridgeStatus();
    if (status.connection !== "open") {
      problem =
        status.connection === "logged_out"
          ? "המכשיר המקושר הוסר מהטלפון (או שהטלפון לא היה מחובר לאינטרנט כשבועיים)."
          : `הגשר לא מחובר לוואטסאפ (מצב: ${status.connection}).`;
      if (status.queued > 0) problem += ` ${status.queued} הודעות מחכות בתור.`;
    }
  } catch {
    problem = "שרת הגשר בגוגל קלאוד לא עונה. ייתכן שהוא כבוי, או שכתובת ה-IP שלו השתנתה.";
  }

  const db = supabaseAdmin();
  const settings = await getWhatsAppSettings();
  const lastAlert = settings.bridge_alert_sent_at ? Date.parse(settings.bridge_alert_sent_at) : 0;

  if (!problem) {
    if (lastAlert) {
      await db.from("whatsapp_settings").update({ bridge_alert_sent_at: null }).eq("id", true);
    }
    return "healthy";
  }

  if (lastAlert && now.getTime() - lastAlert < REALERT_MS) return "already_alerted";

  const to = process.env.ALERT_EMAIL || process.env.POSTMARK_REPLY_TO;
  if (!to) return "no_recipient";

  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://crm-system-eight-omega.vercel.app";
  try {
    await sendEmail({
      to,
      subject: "הוואטסאפ של ה-CRM מנותק",
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">
<p><strong>הוואטסאפ של ה-CRM לא שולח הודעות כרגע.</strong></p>
<p>${problem}</p>
<p>כדי לחבר מחדש: נכנסים ל<a href="${site}/whatsapp">דף הוואטסאפ ב-CRM</a>, מקבלים קוד חיבור, ומקלידים אותו בטלפון בוואטסאפ ביזנס ← הגדרות ← מכשירים מקושרים.</p>
<p style="color:#6b726d;font-size:13px">המייל הזה נשלח לכל היותר פעם ב-12 שעות, כל עוד הניתוק נמשך.</p>
</div>`,
    });
  } catch (error) {
    console.error("[bridge-alert] מייל ההתראה לא נשלח:", error);
    return "failed";
  }

  await db
    .from("whatsapp_settings")
    .update({ bridge_alert_sent_at: now.toISOString() })
    .eq("id", true);
  return "alerted";
}
