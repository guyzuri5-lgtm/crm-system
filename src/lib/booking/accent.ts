import type { CSSProperties } from "react";
import type { StatusColor } from "@/lib/status-colors";

/**
 * צבע המבטא של דף ההזמנה, שנגזר מהצבע שנבחר לסוג הפגישה.
 *
 * למה משתני CSS ולא מחלקות Tailwind: Tailwind v4 סורק את קוד המקור ומייצר
 * CSS רק למחלקות שהוא רואה כתובות שם במלואן, ולכן `bg-${color}-50` שנבנה
 * בזמן ריצה לא מייצר שום סגנון. הפתרון שכן עובד הוא הפוך — ארבעה משתנים
 * שמוזרקים ב-style על עוטף הדף, וכל מי שמתחתיו משתמש ב-var(--accent) קבוע.
 * זו גם הסיבה שכל הרכיבים בהמשך העץ לא צריכים לקבל את הצבע כ-prop.
 *
 * הערכים הם פלטת Tailwind, כדי שהצבעים בדף הציבורי יהיו בדיוק אותם צבעים
 * שמופיעים בתגית של הסטטוס בדשבורד (src/lib/status-colors.ts).
 */

interface Accent {
  /** 600 — הצבע המלא: כפתורים, יום נבחר, אייקונים */
  base: string;
  /** 700 — hover ומצב פעיל */
  strong: string;
  /** 50 — רקע רחב: פס הכותרת, כרטיס הסיכום */
  soft: string;
  /** 100 — רקע של אלמנט בודד: יום פנוי בלוח, hover על שעה */
  muted: string;
}

const ACCENTS: Record<StatusColor, Accent> = {
  blue: { base: "#2563eb", strong: "#1d4ed8", soft: "#eff6ff", muted: "#dbeafe" },
  amber: { base: "#d97706", strong: "#b45309", soft: "#fffbeb", muted: "#fef3c7" },
  violet: { base: "#7c3aed", strong: "#6d28d9", soft: "#f5f3ff", muted: "#ede9fe" },
  emerald: { base: "#059669", strong: "#047857", soft: "#ecfdf5", muted: "#d1fae5" },
  stone: { base: "#57534e", strong: "#44403c", soft: "#fafaf9", muted: "#f5f5f4" },
  rose: { base: "#e11d48", strong: "#be123c", soft: "#fff1f2", muted: "#ffe4e6" },
  sky: { base: "#0284c7", strong: "#0369a1", soft: "#f0f9ff", muted: "#e0f2fe" },
  orange: { base: "#ea580c", strong: "#c2410c", soft: "#fff7ed", muted: "#ffedd5" },
  lime: { base: "#65a30d", strong: "#4d7c0f", soft: "#f7fee7", muted: "#ecfccb" },
  cyan: { base: "#0891b2", strong: "#0e7490", soft: "#ecfeff", muted: "#cffafe" },
  fuchsia: { base: "#c026d3", strong: "#a21caf", soft: "#fdf4ff", muted: "#fae8ff" },
  slate: { base: "#475569", strong: "#334155", soft: "#f8fafc", muted: "#f1f5f9" },
};

/**
 * ארבעת המשתנים, מוכנים להזרקה ב-style.
 *
 * ה-cast הוא כי CSSProperties של React לא מכיר מאפיינים מותאמים — הוא כן
 * מרנדר אותם נכון, רק לא מקליד אותם.
 */
export function accentStyle(color: string | null | undefined): CSSProperties {
  const accent = ACCENTS[(color ?? "blue") as StatusColor] ?? ACCENTS.blue;
  return {
    "--accent": accent.base,
    "--accent-strong": accent.strong,
    "--accent-soft": accent.soft,
    "--accent-muted": accent.muted,
  } as CSSProperties;
}
