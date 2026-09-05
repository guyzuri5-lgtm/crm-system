import type { CSSProperties } from "react";
import { statusToken } from "@/lib/status-colors";

/**
 * צבע המבטא של דף ההזמנה, שנגזר מהצבע שנבחר לסוג הפגישה.
 *
 * למה משתני CSS ולא מחלקות Tailwind: Tailwind v4 סורק את קוד המקור ומייצר
 * CSS רק למחלקות שהוא רואה כתובות שם במלואן, ולכן `bg-${color}-50` שנבנה
 * בזמן ריצה לא מייצר שום סגנון. הפתרון שכן עובד הוא הפוך — משתנים שמוזרקים
 * ב-style על עוטף הדף, וכל מי שמתחתיו משתמש ב-var(--accent) קבוע. זו גם
 * הסיבה שכל הרכיבים בהמשך העץ לא צריכים לקבל את הצבע כ-prop.
 *
 * ── מה השתנה בשלב 6 ──
 * הערכים היו hex קשיחים מפלטת Tailwind. הם נראו נכון בנייר בהיר, אבל הם לא
 * מגיבים ל-data-theme — כלומר דף ההזמנה היה נשאר בהיר גם כשכל השאר עבר
 * לכהה. עכשיו הבסיס הוא אסימון פטינה (statusToken ממפה את שנים-עשר שמות
 * הצבע לשישה אסימונים), ושלושת הגוונים נגזרים ממנו ב-color-mix מול משטחי
 * המערכת. התוצאה: אותה הבחנה בין סוגי פגישות, ומצב כהה בחינם.
 */

/**
 * חמישה משתנים, מוכנים להזרקה ב-style.
 *
 * ה-cast הוא כי CSSProperties של React לא מכיר מאפיינים מותאמים — הוא כן
 * מרנדר אותם נכון, רק לא מקליד אותם.
 */
export function accentStyle(color: string | null | undefined): CSSProperties {
  const base = statusToken(color);
  return {
    /** הצבע המלא: כפתורים, יום נבחר, אייקונים. */
    "--accent": base,
    /** ריחוף ומצב פעיל — אותו גוון, מודגש יותר מול הדיו. */
    "--accent-strong": `color-mix(in srgb, ${base} 80%, var(--foreground))`,
    /** רקע רחב: פס הכותרת, כרטיס הסיכום. */
    "--accent-soft": `color-mix(in srgb, ${base} 9%, var(--surface))`,
    /** רקע של אלמנט בודד: יום פנוי בלוח, ריחוף על שעה. */
    "--accent-muted": `color-mix(in srgb, ${base} 18%, var(--surface))`,
    /**
     * מה שנקרא *על* המבטא. אותו נימוק כמו --on-primary: בנייר כהה הגוונים
     * מתבהרים, וטקסט לבן עליהם נופל מתחת לסף הניגודיות.
     */
    "--accent-on": "var(--on-primary)",
  } as CSSProperties;
}
