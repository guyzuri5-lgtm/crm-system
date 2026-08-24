import type { ContactStatus } from "@/lib/supabase/database.types";

const COLORS: Record<ContactStatus, string> = {
  ליד_חדש: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
  יצרנו_קשר: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
  מתעניין: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20",
  סגר_עסקה: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  לא_רלוונטי: "bg-stone-100 text-stone-500 ring-1 ring-inset ring-stone-500/10",
};

export function StatusBadge({ status }: { status: ContactStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[status]}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
