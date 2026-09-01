// דף הנחיתה של קורס המדיטציה — ולידציה של ה-payload שמגיע מהדפדפן.
//
// המקור לאמת של תוכן הדף הוא landing-page.html שיושב מחוץ לפרויקט הזה.
// כאן יושב רק מה שנדרש כדי לקלוט את הליד.
//
// normalizePhone ו-usableEmail מיובאים מ-quiz ולא משוכפלים: אותם אנשים
// ממלאים את שני הטפסים, והתאמה לאיש קשר קיים עובדת רק אם שני המקורות
// מנרמלים טלפון בדיוק אותו דבר.

import { z } from "zod";
export { usableEmail, normalizePhone } from "./quiz";

export const coursePayloadSchema = z.object({
  // lead → השאיר פרטים | payment_click → לחץ על המעבר לתשלום
  type: z.enum(["lead", "payment_click"]).default("lead"),
  sessionId: z.string().min(6).max(100),

  name:  z.string().max(120).optional().default(""),
  email: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  consent: z.boolean().optional().default(false),

  source: z.string().max(500).optional().default(""),
  utm: z.record(z.string().max(40), z.string().max(300)).optional().default({}),
})
  // רשומה חייבת לשאת דרך ליצור קשר. בלי זה כל POST עם sessionId תקין היה
  // יוצר שורה ריקה — רעש שקל לייצר נגד endpoint ציבורי.
  .refine((d) => d.email.trim() !== "" || d.phone.trim() !== "", {
    message: "צריך לפחות אימייל או טלפון",
  });

export type CoursePayload = z.infer<typeof coursePayloadSchema>;
