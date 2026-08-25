import "server-only";

import { CHAKRA_KEYS, FLOW_STATUSES, flowStatus, type ChakraKey, type QuizPayload } from "./quiz";
import { BRIDGE, CHAKRA_META, DIAGNOSIS, PERSISTENCE, type FlowKey } from "./quiz-copy.generated";

// בניית "הדוח המלא על שבע הצ'אקרות" שנשלח במייל אחרי מילוי טופס הלידים.
//
// הטקסטים מגיעים מ-quiz-copy.generated.ts, שנשאב מ-index.html (npm run sync:quiz-copy).
// הם לא מגיעים מה-payload בכוונה: /api/webhooks/quiz הוא endpoint ציבורי, וטקסט
// חופשי משם שהיה נשלח במייל לכתובת כלשהי היה הופך אותו לממסר ספאם בשם גיא.
//
// גם הסטטוס לכל מרכז מחושב כאן מחדש מהציונים, ולא נלקח מ-payload.statuses —
// הציונים עוברים ולידציה מספרית (0–100), הסטטוסים הם מחרוזת חופשית.

const CALENDLY_FALLBACK = "https://calendly.com/guyzuri5/30min";

/** תווית הסטטוס היא גם המפתח לבלוק האבחון — הן חולקות את אותם ארבעה ערכים. */
function flowKeyFor(score: number): FlowKey {
  return flowStatus(score).key as FlowKey;
}

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

/** מיון מהחסום ביותר לפתוח ביותר, עם שובר-שוויון יציב לפי סדר המרכזים. */
function rankedKeys(scores: Partial<Record<ChakraKey, number>>): ChakraKey[] {
  return CHAKRA_KEYS.filter((k) => scores[k] != null).sort((a, b) => {
    const diff = (scores[a] ?? 0) - (scores[b] ?? 0);
    return diff !== 0 ? diff : CHAKRA_META[a].id - CHAKRA_META[b].id;
  });
}

// ── לבני HTML ────────────────────────────────────────────────────────────
// מיילים נבנים בטבלאות ובסגנון inline: Gmail מסיר <style> חיצוני, ו-Outlook
// לא תומך ב-flex/grid. dir="rtl" חוזר על עצמו בכל בלוק מאותה סיבה.

const FONT = "'Assistant', 'Segoe UI', Arial, sans-serif";
const INK = "#2A2620";
const INK_SOFT = "#5A5248";
const LINE = "#E6DFD4";
const PAPER = "#FBF8F3";

/** שורה אחת במפה האנרגטית: שם, מד מלא באחוזים, ציון ותווית. */
function mapRow(key: ChakraKey, score: number): string {
  const meta = CHAKRA_META[key];
  const status = flowStatus(score);
  const filled = Math.max(2, Math.round(score));

  return `
  <tr>
    <td dir="rtl" style="padding:7px 0 3px;font:600 14px ${FONT};color:${INK};">
      ${esc(meta.name)}
      <span style="font-weight:400;color:${status.color};font-size:12.5px;">· ${esc(status.label)}</span>
      <span style="float:left;font-weight:700;color:${INK_SOFT};font-size:13px;">${score}</span>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 9px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="border-collapse:separate;background:${LINE};border-radius:5px;">
        <tr>
          <td width="${filled}%" style="height:9px;line-height:9px;font-size:0;background:${meta.color};border-radius:5px;">&nbsp;</td>
          <td style="height:9px;line-height:9px;font-size:0;">&nbsp;</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/** כרטיס מרכז: כותרת, מה זה אומר, סימנים (רק למרכז החסום) והצעד הראשון. */
function centerCard(key: ChakraKey, score: number, opts: { highlight: boolean }): string {
  const meta = CHAKRA_META[key];
  const status = flowStatus(score);
  const entry = DIAGNOSIS[key][flowKeyFor(score)];

  const signs = opts.highlight
    ? `<ul dir="rtl" style="margin:10px 0 0;padding:0 18px 0 0;font:400 14px/1.65 ${FONT};color:${INK_SOFT};">
         ${entry.signs.map((s) => `<li style="margin:0 0 4px;">${esc(s)}</li>`).join("")}
       </ul>`
    : "";

  const bridge = opts.highlight
    ? `<p dir="rtl" style="margin:12px 0 0;font:600 14px/1.6 ${FONT};color:${meta.ink};">${esc(BRIDGE[key])}</p>`
    : "";

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="border-collapse:separate;margin:0 0 14px;background:#FFFFFF;
                border:1px solid ${opts.highlight ? meta.color : LINE};
                border-radius:12px;${opts.highlight ? `border-right:5px solid ${meta.color};` : ""}">
    <tr>
      <td style="padding:16px 18px;">
        <p dir="rtl" style="margin:0;font:700 16px ${FONT};color:${meta.ink};">
          ${esc(meta.name)}
          <span style="font-weight:400;font-size:13px;color:${INK_SOFT};">· ${esc(meta.sanskrit)}</span>
        </p>
        <p dir="rtl" style="margin:6px 0 0;font:600 13px ${FONT};color:${status.color};">
          ${esc(status.label)} · ${score}/100
        </p>
        <p dir="rtl" style="margin:10px 0 0;font:400 14px/1.7 ${FONT};color:${INK};">${esc(entry.meaning)}</p>
        ${signs}
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="border-collapse:separate;margin:12px 0 0;background:${PAPER};border-radius:9px;">
          <tr>
            <td style="padding:11px 13px;">
              <p dir="rtl" style="margin:0 0 3px;font:700 12px ${FONT};color:${INK_SOFT};letter-spacing:.02em;">הצעד הראשון</p>
              <p dir="rtl" style="margin:0;font:400 14px/1.65 ${FONT};color:${INK};">${esc(entry.step)}</p>
            </td>
          </tr>
        </table>
        ${bridge}
      </td>
    </tr>
  </table>`;
}

export interface QuizReportEmail {
  subject: string;
  html: string;
}

/**
 * בונה את מייל הדוח מתוך ה-payload המאומת.
 * מחזיר null אם אין מספיק נתונים כדי להרכיב דוח אמיתי.
 */
export function buildQuizReportEmail(p: QuizPayload): QuizReportEmail | null {
  const scores = p.scores;
  if (!scores || !p.lowestChakra) return null;

  const ranked = rankedKeys(scores);
  if (ranked.length < CHAKRA_KEYS.length) return null;

  // המרכז החסום נקבע מהציונים ולא מ-lowestChakra שהגיע מהדפדפן, כדי שהכותרת
  // והכרטיס המודגש לא יוכלו לסתור את המפה שמופיעה מתחתיהם.
  const lowest = ranked[0];
  const lowestScore = scores[lowest] as number;
  const lowestMeta = CHAKRA_META[lowest];

  const balance = p.balanceDisplay ?? (p.balanceIndex != null ? Math.round(p.balanceIndex / 10) : null);
  const name = firstName(p.name);
  const greeting = name ? `${esc(name)}, הנה הדוח המלא שלך.` : "הנה הדוח המלא שלך.";

  const calendly = (process.env.QUIZ_CALENDLY_URL || CALENDLY_FALLBACK).trim();

  const balanceCard =
    balance != null
      ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="border-collapse:separate;margin:0 0 18px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;">
      <tr>
        <td style="padding:14px 18px;">
          <p dir="rtl" style="margin:0;font:400 13px ${FONT};color:${INK_SOFT};">מדד האיזון הכללי שלך</p>
          <p dir="rtl" style="margin:4px 0 0;font:800 26px ${FONT};color:${INK};">${balance}<span style="font-size:15px;font-weight:600;color:${INK_SOFT};">/10</span></p>
        </td>
      </tr>
    </table>`
      : "";

  const others = ranked.slice(1);

  const html = `<!doctype html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>הדוח המלא שלך — שבע הצ'אקרות</title></head>
<body style="margin:0;padding:0;background:#F2EDE4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  ${esc(lowestMeta.name)} יצאה החסומה ביותר אצלך — ${lowestScore}/100. בפנים: כל שבעת המרכזים והצעד הראשון לכל אחד.
</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2EDE4;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             style="width:600px;max-width:100%;border-collapse:separate;">

        <tr>
          <td dir="rtl" style="padding:0 4px 14px;">
            <p style="margin:0;font:800 15px ${FONT};color:${INK};">גיא צורי</p>
            <p style="margin:2px 0 0;font:400 13px ${FONT};color:${INK_SOFT};">שחרור חסימות אנרגטיות</p>
          </td>
        </tr>

        <tr>
          <td style="background:#FFFFFF;border:1px solid ${LINE};border-radius:16px;padding:24px 20px;">

            <h1 dir="rtl" style="margin:0;font:800 22px/1.35 ${FONT};color:${INK};">הדוח המלא שלך — שבע הצ'אקרות</h1>
            <p dir="rtl" style="margin:8px 0 0;font:400 15px/1.7 ${FONT};color:${INK_SOFT};">${greeting}</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="border-collapse:separate;margin:18px 0;background:${PAPER};
                          border:1px solid ${lowestMeta.color};border-right:5px solid ${lowestMeta.color};border-radius:12px;">
              <tr>
                <td style="padding:15px 18px;">
                  <p dir="rtl" style="margin:0;font:400 13px ${FONT};color:${INK_SOFT};">המרכז החסום ביותר אצלך</p>
                  <p dir="rtl" style="margin:4px 0 0;font:800 19px ${FONT};color:${lowestMeta.ink};">
                    ${esc(lowestMeta.name)}
                    <span style="font-weight:400;font-size:14px;color:${INK_SOFT};">· ${lowestScore}/100</span>
                  </p>
                </td>
              </tr>
            </table>

            ${balanceCard}

            <h2 dir="rtl" style="margin:22px 0 10px;font:700 17px ${FONT};color:${INK};">המפה האנרגטית שלך</h2>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
              ${ranked.map((k) => mapRow(k, scores[k] as number)).join("")}
            </table>

            <h2 dir="rtl" style="margin:26px 0 12px;font:700 17px ${FONT};color:${INK};">האבחון המלא</h2>
            ${centerCard(lowest, lowestScore, { highlight: true })}
            ${others.map((k) => centerCard(k, scores[k] as number, { highlight: false })).join("")}

            <p dir="rtl" style="margin:20px 0 0;font:400 14px/1.7 ${FONT};color:${INK_SOFT};">${esc(PERSISTENCE)}</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="border-collapse:separate;margin:22px 0 0;background:${INK};border-radius:14px;">
              <tr>
                <td align="center" style="padding:22px 18px;">
                  <p dir="rtl" style="margin:0;font:700 18px ${FONT};color:#FFFFFF;">רוצה לשחרר את זה בפועל?</p>
                  <p dir="rtl" style="margin:8px 0 16px;font:400 14px/1.65 ${FONT};color:#D9D1C4;">
                    בשיחת היכרות קצרה נעבור על הדוח שלך ונראה מאיפה מתחילים.
                  </p>
                  <a href="${esc(calendly)}"
                     style="display:inline-block;background:#FFFFFF;color:${INK};text-decoration:none;
                            font:700 15px ${FONT};padding:13px 30px;border-radius:999px;">
                    לקביעת שיחת היכרות
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <tr>
          <td dir="rtl" style="padding:16px 8px 0;">
            <p style="margin:0;font:400 12px/1.65 ${FONT};color:#8A8175;">
              קיבלת את המייל הזה כי מילאת את שאלון הצ'אקרות באתר של גיא צורי ואישרת קבלת תוצאות במייל.
              לא רוצה לקבל עוד? השיבו למייל הזה במילה "הסר".
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const subject = name
    ? `${name}, הדוח המלא שלך — ${lowestMeta.name} יצאה החסומה ביותר`
    : `הדוח המלא שלך — ${lowestMeta.name} יצאה החסומה ביותר`;

  return { subject, html };
}

/** נחשף לבדיקות ולעתיד: רשימת הסטטוסים שהמייל מכיר. */
export const EMAIL_FLOW_KEYS = FLOW_STATUSES.map((s) => s.key);
