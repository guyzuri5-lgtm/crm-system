"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// לשוניות המשנה של מסך הפגישות. רכיב לקוח רק בגלל usePathname — הוא מה
// שמסמן איזו לשונית פעילה, ואין לו דרך לדעת זאת בשרת בלי לקבל את הנתיב
// כ-prop מכל עמוד בנפרד.
const TABS = [
  { href: "/booking", label: "סוגי פגישות" },
  { href: "/booking/calendar", label: "יומן זמינות" },
  { href: "/booking/upcoming", label: "פגישות קרובות" },
  { href: "/booking/settings", label: "הגדרות" },
];

export function BookingTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b border-[var(--border)]">
      {TABS.map((tab) => {
        // התאמה מדויקת ל-/booking, אחרת הלשונית הראשונה הייתה נשארת פעילה
        // בכל עמודי המשנה.
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors duration-150",
              active
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
