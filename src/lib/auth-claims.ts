import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";

/**
 * מי מחובר — בדיקה אחת שכל הקוד בשרת עובר דרכה: גם עמודי הדשבורד (דרך
 * ./dal) וגם מסלולי ה-API שהדשבורד קורא להם (דרך ./api-auth).
 *
 * ── למה זה זול, ולמה כדאי לדעת את זה ──
 * הפרויקט עבר ב-24.8.2026 למפתחות חתימה א-סימטריים (ECC P-256). במצב הזה
 * `getClaims()` מאמת את החתימה **מקומית** מול המפתח הציבורי, בלי לשאול את
 * שרת האימות מי המשתמש.
 *
 * את המפתח הציבורי הספרייה מושכת פעם אחת מ-`/.well-known/jwks.json` ושומרת
 * ב-`GLOBAL_JWKS` — משתנה ברמת המודול, לא ברמת מופע הלקוח — עם תפוגה של
 * עשר דקות. לכן העובדה ש-‎@supabase/ssr מחייב מופע חדש בכל בקשה **אינה**
 * מבטלת את הקאש: המשיכה קורית פעם אחת לכל תהליך Node. נמדד: הקריאה
 * הראשונה 588ms, כל אלה שאחריה מילישנייה אחת.
 *
 * זה נבדק כאן בטעות אמיתית. אם מישהו יחזור על ההיגיון "הלקוח נוצר מחדש
 * בכל בקשה, אז גם ה-JWKS נמשך מחדש" — הוא שגוי, ואין צורך בשכבת קאש
 * משלנו. מה שכן היה שובר את זה: חזרה למפתח סימטרי (HS256). שם אין מה לאמת
 * מקומית, ו-getClaims נופל לקריאת רשת אל /auth/v1/user בכל בקשה.
 *
 * cache() של React: כל הקריאות בתוך אותה בקשה מתלכדות לאחת.
 */

export interface TeamClaims {
  userId: string;
  email: string | null;
}

/** התביעות של הסשן הנוכחי, או null כשאין סשן תקף. */
export const readTeamClaims = cache(async (): Promise<TeamClaims | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  return {
    userId: data.claims.sub as string,
    email: (data.claims.email as string | undefined) ?? null,
  };
});
