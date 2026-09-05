"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * לשוניות ההגדרות.
 *
 * רכיב לקוח רק בשביל דבר אחד: לדעת באיזו לשונית אנחנו עומדים. עד עכשיו כל
 * ארבע הלשוניות נראו זהות, ולא היה שום סימן לאיזו מהן נכנסת — מה שהפך את
 * הניווט לניחוש.
 *
 * קישורים ולא כפתורים: כל לשונית היא ניתוב אמיתי, כך שאפשר לשמור מועדף
 * ישירות ללשונית ושהחזרה אחורה בדפדפן תעבוד כמצופה.
 */
export function SettingsTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-0.5 border-b border-[var(--border)]">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="tab"
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
