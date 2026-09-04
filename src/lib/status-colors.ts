// הפלטה שממנה נבחר צבע לסטטוס. חייבת להישאר רשימה סגורה שכתובה ליטרלית בקוד:
// Tailwind v4 סורק את קוד המקור ומייצר CSS רק למחלקות שהוא רואה שם, אז
// `bg-${color}-50` שנבנה בזמן ריצה פשוט לא ייצר שום סגנון. כל מחלקה כאן
// מופיעה כמחרוזת שלמה, וה-DB אוכף את אותה רשימה ב-check constraint
// (supabase/migrations/0003_statuses.sql) כדי ששני הצדדים לא יסטו.
//
// ── למה שמות הצבעים לא השתנו בעיצוב החדש ──
// אותם שנים-עשר שמות אכופים ב-check constraint במסד, ולכל סטטוס קיים כבר
// שמור שם צבע. שינוי שם כאן היה דורש מיגרציה ועדכון נתונים בשביל עניין
// חזותי בלבד. לכן `blue` נשאר `blue` — הוא פשוט נראה אחרת.
//
// ── מצב כהה ──
// המחלקות האלה הן ערכי Tailwind קבועים ולא אסימונים, ולכן הן לא מתחלפות
// לבד. הווריאנט `dark:` מוגדר ב-globals.css כך שהוא מקשיב ל-data-theme
// שהמערכת מדליקה, ולא ל-prefers-color-scheme.

export const STATUS_COLOR_CLASSES = {
  blue: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-400/12 dark:text-blue-300 dark:ring-blue-400/25",
  amber:
    "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/12 dark:text-amber-300 dark:ring-amber-400/25",
  violet:
    "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-400/12 dark:text-violet-300 dark:ring-violet-400/25",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/25",
  stone:
    "bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/15 dark:bg-stone-400/10 dark:text-stone-300 dark:ring-stone-400/20",
  rose: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-400/12 dark:text-rose-300 dark:ring-rose-400/25",
  sky: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-400/12 dark:text-sky-300 dark:ring-sky-400/25",
  orange:
    "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-600/20 dark:bg-orange-400/12 dark:text-orange-300 dark:ring-orange-400/25",
  lime: "bg-lime-50 text-lime-800 ring-1 ring-inset ring-lime-600/20 dark:bg-lime-400/12 dark:text-lime-300 dark:ring-lime-400/25",
  cyan: "bg-cyan-50 text-cyan-800 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-400/12 dark:text-cyan-300 dark:ring-cyan-400/25",
  fuchsia:
    "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-600/20 dark:bg-fuchsia-400/12 dark:text-fuchsia-300 dark:ring-fuchsia-400/25",
  slate:
    "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/15 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/20",
} as const;

export type StatusColor = keyof typeof STATUS_COLOR_CLASSES;

export const STATUS_COLORS = Object.keys(STATUS_COLOR_CLASSES) as StatusColor[];

export const STATUS_COLOR_LABELS: Record<StatusColor, string> = {
  blue: "כחול",
  amber: "ענבר",
  violet: "סגול",
  emerald: "ירוק",
  stone: "אפור",
  rose: "ורוד",
  sky: "תכלת",
  orange: "כתום",
  lime: "ליים",
  cyan: "טורקיז",
  fuchsia: "פוקסיה",
  slate: "פחם",
};

export function statusColorClasses(color: string | null | undefined): string {
  return STATUS_COLOR_CLASSES[(color ?? "stone") as StatusColor] ?? STATUS_COLOR_CLASSES.stone;
}

/** תצוגה: הסטטוסים נשמרו היסטורית עם קו תחתון במקום רווח. */
export function statusLabel(name: string): string {
  return name.replaceAll("_", " ");
}
