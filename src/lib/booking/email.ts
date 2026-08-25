import "server-only";

import {
  BOOKING_LOCATION_LABELS,
  type BookingEventType,
} from "@/lib/supabase/database.types";
import { formatLongDate, formatTime } from "./timezone";

/**
 * מייל האישור שנשלח ללקוח אחרי קביעת פגישה.
 *
 * נבנה בטבלאות ובסגנון inline מאותה סיבה שמייל השאלון נבנה כך (ראו quiz-email.ts):
 * Gmail מסיר <style> חיצוני ו-Outlook לא תומך ב-flex/grid. dir="rtl" חוזר על עצמו
 * בכל בלוק כי חלק מהלקוחות מתעלמים ממנו ברמת המסמך.
 *
 * שימו לב שזה מייל *נוסף* על ההזמנה שגוגל שולח מהיומן — גוגל שולח הזמנה
 * שאפשר לאשר, וזה המייל בשפה שלנו, עם קישור הביטול ועם ה-Meet בגוף ההודעה.
 */

const FONT = "'Assistant', 'Segoe UI', Arial, sans-serif";
const INK = "#2A2620";
const INK_SOFT = "#5A5248";
const LINE = "#E6DFD4";
const PAPER = "#FBF8F3";
const ACCENT = "#0f766e";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

function detailRow(label: string, value: string): string {
  return `
  <tr>
    <td dir="rtl" style="padding:9px 0;border-bottom:1px solid ${LINE};font:400 14px ${FONT};color:${INK_SOFT};width:90px;vertical-align:top;">${esc(label)}</td>
    <td dir="rtl" style="padding:9px 0;border-bottom:1px solid ${LINE};font:600 14px ${FONT};color:${INK};">${value}</td>
  </tr>`;
}

export interface ConfirmationEmailInput {
  eventType: BookingEventType;
  inviteeName: string;
  start: Date;
  timeZone: string;
  meetUrl: string | null;
  cancelUrl: string;
  brandName: string;
}

export function buildConfirmationEmail(input: ConfirmationEmailInput): {
  subject: string;
  html: string;
} {
  const { eventType, inviteeName, start, timeZone, meetUrl, cancelUrl, brandName } = input;

  const dateLabel = formatLongDate(start, timeZone);
  const timeLabel = formatTime(start, timeZone);

  const locationValue = meetUrl
    ? `<a href="${esc(meetUrl)}" style="color:${ACCENT};text-decoration:none;">${esc(meetUrl)}</a>`
    : eventType.location_details
      ? esc(eventType.location_details)
      : esc(BOOKING_LOCATION_LABELS[eventType.location]);

  const subject = `הפגישה נקבעה — ${eventType.name}, ${dateLabel} בשעה ${timeLabel}`;

  const html = `
<div dir="rtl" style="margin:0;padding:24px 12px;background:${PAPER};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
    <tr>
      <td style="padding:26px 26px 6px;">
        <p dir="rtl" style="margin:0 0 4px;font:400 13px ${FONT};color:${INK_SOFT};">${esc(brandName)}</p>
        <h1 dir="rtl" style="margin:0;font:700 21px ${FONT};color:${INK};">הפגישה נקבעה ✓</h1>
        <p dir="rtl" style="margin:12px 0 0;font:400 15px ${FONT};color:${INK_SOFT};line-height:1.6;">
          ${esc(firstName(inviteeName))} שלום, מחכה לך. הנה הפרטים:
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 26px 4px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="border-collapse:collapse;">
          ${detailRow("נושא", esc(eventType.name))}
          ${detailRow("מתי", `${esc(dateLabel)}<br><span style="font-weight:400;color:${INK_SOFT};">בשעה ${esc(timeLabel)} · ${eventType.duration_minutes} דקות</span>`)}
          ${detailRow("איפה", locationValue)}
        </table>
      </td>
    </tr>
    ${
      meetUrl
        ? `<tr>
      <td style="padding:20px 26px 4px;">
        <a href="${esc(meetUrl)}"
           style="display:inline-block;background:${ACCENT};color:#ffffff;font:600 15px ${FONT};
                  text-decoration:none;padding:12px 22px;border-radius:9px;">
          הצטרפות לפגישה
        </a>
      </td>
    </tr>`
        : ""
    }
    <tr>
      <td style="padding:18px 26px 26px;">
        <p dir="rtl" style="margin:0;font:400 13px ${FONT};color:${INK_SOFT};line-height:1.7;">
          הפגישה נוספה גם ליומן שלך בהזמנה נפרדת מגוגל.<br>
          לא מסתדר? אפשר
          <a href="${esc(cancelUrl)}" style="color:${ACCENT};">לבטל את הפגישה כאן</a>.
        </p>
      </td>
    </tr>
  </table>
</div>`.trim();

  return { subject, html };
}

export function buildCancellationEmail(input: {
  eventType: BookingEventType;
  inviteeName: string;
  start: Date;
  timeZone: string;
  brandName: string;
  rebookUrl: string;
}): { subject: string; html: string } {
  const { eventType, inviteeName, start, timeZone, brandName, rebookUrl } = input;
  const dateLabel = formatLongDate(start, timeZone);
  const timeLabel = formatTime(start, timeZone);

  return {
    subject: `הפגישה בוטלה — ${eventType.name}, ${dateLabel}`,
    html: `
<div dir="rtl" style="margin:0;padding:24px 12px;background:${PAPER};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
    <tr>
      <td style="padding:26px;">
        <p dir="rtl" style="margin:0 0 4px;font:400 13px ${FONT};color:${INK_SOFT};">${esc(brandName)}</p>
        <h1 dir="rtl" style="margin:0 0 12px;font:700 20px ${FONT};color:${INK};">הפגישה בוטלה</h1>
        <p dir="rtl" style="margin:0 0 18px;font:400 15px ${FONT};color:${INK_SOFT};line-height:1.6;">
          ${esc(firstName(inviteeName))} שלום, הפגישה שנקבעה ל־${esc(dateLabel)} בשעה ${esc(timeLabel)} בוטלה.
        </p>
        <a href="${esc(rebookUrl)}"
           style="display:inline-block;background:${ACCENT};color:#ffffff;font:600 15px ${FONT};
                  text-decoration:none;padding:11px 20px;border-radius:9px;">
          קביעת מועד חדש
        </a>
      </td>
    </tr>
  </table>
</div>`.trim(),
  };
}
