// שאלון הצ'אקרות — טיפוסים, ולידציה וקבועי תצוגה.
//
// המקור לאמת של תוכן השאלון הוא index.html שבתיקיית האב. כאן יושב רק מה
// שנדרש כדי לקלוט את התוצאה ולהציג אותה: שמות המרכזים, צבעים, ומיקום על
// דמות המדיטציה. אם מוסיפים או משנים מרכז — צריך לעדכן גם כאן.

import { z } from "zod";

export const CHAKRA_KEYS = [
  "root", "sacral", "solar", "heart", "throat", "thirdEye", "crown",
] as const;
export type ChakraKey = (typeof CHAKRA_KEYS)[number];

export const CHAKRAS: Record<
  ChakraKey,
  { name: string; color: string; ink: string; location: string; short: string[]; body: { x: number; y: number } }
> = {
  root:     { name: "צ'אקרת השורש", color: "#C0392B", ink: "#96291D", location: "בסיס עמוד השדרה", short: ["בסיס", "פיזי"],     body: { x: 100, y: 143 } },
  sacral:   { name: "צ'אקרת המין",  color: "#E67E22", ink: "#96530F", location: "מתחת לטבור",      short: ["מפשעה", "חיוניות"], body: { x: 100, y: 104 } },
  solar:    { name: "מקלעת השמש",   color: "#F1C40F", ink: "#8A6B00", location: "מעל הטבור",       short: ["מקלעת", "שמש"],     body: { x: 100, y: 86 } },
  heart:    { name: "צ'אקרת הלב",   color: "#27AE60", ink: "#17703E", location: "מרכז החזה",       short: ["לב"],               body: { x: 100, y: 66 } },
  throat:   { name: "צ'אקרת הגרון", color: "#2980B9", ink: "#1F6390", location: "אזור הגרון",      short: ["גרון", "ביטוי"],    body: { x: 100, y: 45 } },
  thirdEye: { name: "העין השלישית", color: "#5B2C8D", ink: "#4A2373", location: "בין הגבות",       short: ["עין", "שלישית"],    body: { x: 100, y: 22 } },
  crown:    { name: "צ'אקרת הכתר",  color: "#8E44AD", ink: "#6F3488", location: "קודקוד הראש",     short: ["כתר", "רוחני"],     body: { x: 100, y: 7 } },
};

export const FLOW_STATUSES = [
  { key: "blocked",  min: 0,  max: 39,  label: "חסומה",  color: "#B3261E", bg: "#FBEAE8" },
  { key: "partial",  min: 40, max: 64,  label: "חלקית",  color: "#8A6B00", bg: "#FBF3D9" },
  { key: "balanced", min: 65, max: 84,  label: "מאוזנת", color: "#1E6640", bg: "#E9F5EE" },
  { key: "open",     min: 85, max: 100, label: "פתוחה",  color: "#1F6390", bg: "#E8F1F8" },
] as const;

export function flowStatus(score: number) {
  return FLOW_STATUSES.find((s) => score >= s.min && score <= s.max) ?? FLOW_STATUSES[0];
}

/** תוויות הסולם, לפי הניקוד הגולמי 0–3 */
export const SCALE_LABELS = ["בכלל לא נכון", "קצת נכון", "נכון", "מאוד נכון"] as const;

// ── ולידציה של ה-payload מהשאלון ─────────────────────────────────────────
// הדף פתוח לציבור, ולכן כל מה שמגיע נחשב לא מהימן עד שהוא עובר כאן.

// partialRecord ולא record: ב-zod v4 מפתח מסוג enum הופך את הרשומה למלאה —
// כלומר כל שבעת המרכזים חייבים להופיע, אחרת ה-payload נדחה. אנחנו רוצים
// לקבל גם רשומה חלקית, ולא להישבר אם יתווסף מרכז בעתיד.
const scoreMap = z.partialRecord(z.enum(CHAKRA_KEYS), z.number().int().min(0).max(100));

export const quizPayloadSchema = z.object({
  type: z.enum(["anonymous", "lead", "booking_click"]).default("anonymous"),
  sessionId: z.string().min(6).max(100),

  name:  z.string().max(120).optional().default(""),
  email: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  consent: z.boolean().optional().default(false),

  lowestChakra: z.enum(CHAKRA_KEYS).optional(),
  lowestChakraName: z.string().max(60).optional(),

  scores: scoreMap.optional(),
  statuses: z.partialRecord(z.enum(CHAKRA_KEYS), z.string().max(20)).optional(),

  answers: z
    .array(
      z.object({
        id: z.number().int().min(1).max(200),
        chakra: z.enum(CHAKRA_KEYS),
        text: z.string().max(400),
        score: z.number().int().min(0).max(10).nullable(),
      })
    )
    .max(200)
    .optional(),

  balanceIndex:   z.number().int().min(0).max(100).optional(),
  balanceDisplay: z.number().int().min(0).max(10).optional(),
  meanScore:      z.number().int().min(0).max(100).optional(),
  spread:         z.number().int().min(0).max(100).optional(),

  source: z.string().max(500).optional().default(""),
  utm: z.record(z.string().max(40), z.string().max(300)).optional().default({}),
  bookingFrom: z.string().max(60).optional(),
})
  // רשומה חייבת לשאת תוצאה אמיתית. בלי זה כל POST עם sessionId תקין
  // היה יוצר שורה ריקה — רעש שקל לייצר נגד endpoint ציבורי.
  .refine(
    (d) => d.lowestChakra != null && d.scores != null && Object.keys(d.scores).length >= 7,
    { message: "חסרים ציונים או זיהוי המרכז החסום" }
  );

export type QuizPayload = z.infer<typeof quizPayloadSchema>;

/** האימייל תקין מספיק כדי ליצור ממנו איש קשר? */
export function usableEmail(value: string): string | null {
  const v = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) ? v : null;
}

/** נרמול טלפון ישראלי לפורמט אחיד, כדי שההתאמה ל-contacts.phone תעבוד */
export function normalizePhone(value: string): string | null {
  let d = value.replace(/[^\d+]/g, "");
  d = d.replace(/^00972/, "0").replace(/^\+972/, "0");
  if (!/^0(5\d{8}|7[2-9]\d{7}|[23489]\d{7})$/.test(d)) return null;
  return d;
}
