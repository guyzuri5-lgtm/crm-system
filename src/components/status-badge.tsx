import { statusColorClasses, statusLabel } from "@/lib/status-colors";

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
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorClasses(color)} ${className}`}
    >
      {statusLabel(status)}
    </span>
  );
}
