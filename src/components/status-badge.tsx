import { statusColorClasses, statusLabel } from "@/lib/status-colors";

/**
 * הנקודה לפני הטקסט צבועה ב-bg-current, כלומר בצבע הטקסט של התווית עצמה.
 * כך היא מקבלת את גוון הסטטוס בלי שיהיה צורך במפת צבעים שנייה — ובלי
 * להוסיף שתים-עשרה מחלקות נוספות שTailwind יצטרך לראות בקוד.
 *
 * למה בכלל נקודה: תווית סטטוס נסרקת בעין בתוך טבלה של מאה שורות. צורה
 * קטנה בקצה קבוע נקראת מהר יותר ממילה, ומי שאינו מבחין היטב בין גוונים
 * עדיין רואה שיש כאן סימון.
 */
export function StatusBadge({
  status,
  color,
  className = "",
}: {
  status: string;
  /** מפתח צבע מ-contact_statuses. ברירת המחדל (אפור) משמשת גם כשסטטוס נמחק מתחת לרגליים. */
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorClasses(color)} ${className}`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {statusLabel(status)}
    </span>
  );
}
