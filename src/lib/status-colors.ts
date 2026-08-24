// הפלטה שממנה נבחר צבע לסטטוס. חייבת להישאר רשימה סגורה שכתובה ליטרלית בקוד:
// Tailwind v4 סורק את קוד המקור ומייצר CSS רק למחלקות שהוא רואה שם, אז
// `bg-${color}-50` שנבנה בזמן ריצה פשוט לא ייצר שום סגנון. כל מחלקה כאן
// מופיעה כמחרוזת שלמה, וה-DB אוכף את אותה רשימה ב-check constraint
// (supabase/migrations/0003_statuses.sql) כדי ששני הצדדים לא יסטו.

export const STATUS_COLOR_CLASSES = {
  blue: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  stone: "bg-stone-100 text-stone-500 ring-1 ring-inset ring-stone-500/10",
  rose: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/20",
  sky: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  orange: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-600/20",
  lime: "bg-lime-50 text-lime-700 ring-1 ring-inset ring-lime-600/20",
  cyan: "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-600/20",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-600/20",
  slate: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/15",
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
