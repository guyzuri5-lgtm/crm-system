"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * סרגל הניווט של המערכת — שתי שורות.
 *
 * למעלה שש קבוצות, כל אחת בצבע משלה; למטה לשוניות המשנה של הקבוצה הפעילה
 * בלבד. הפיצול הזה הוא מה שמאפשר להוסיף ניוזלטר, אירועים וקורסים בלי שהשורה
 * העליונה תתפוצץ: מה שפעם היה שמונה קישורים שטוחים הוא היום שש קבוצות, וכל
 * מסך חדש נכנס כלשונית בתוך קבוצה קיימת.
 *
 * רכיב לקוח רק בגלל usePathname — הוא מה שמסמן איזו קבוצה ואיזו לשונית
 * פעילות, ואין לו דרך לדעת זאת בשרת בלי לקבל את הנתיב כ-prop מכל עמוד בנפרד.
 */

type IconName =
  | "home"
  | "users"
  | "calendar"
  | "route"
  | "mail"
  | "ticket"
  | "school"
  | "settings";

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  ticket: (
    <>
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </>
  ),
  school: (
    <>
      <path d="M22 10v6" />
      <path d="M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

interface NavTab {
  href: string;
  label: string;
}

interface NavGroup {
  key: string;
  label: string;
  icon: IconName;
  /** רקע הקבוצה הפעילה */
  soft: string;
  /** צבע הטקסט כשהקבוצה פעילה */
  strong: string;
  /** צבע האייקון — תמיד, גם כשהקבוצה אינה פעילה */
  iconColor: string;
  tabs: NavTab[];
}

const GROUPS: NavGroup[] = [
  {
    key: "customers",
    label: "לקוחות",
    icon: "users",
    soft: "var(--primary-soft)",
    strong: "var(--primary)",
    iconColor: "var(--primary)",
    tabs: [
      { href: "/active", label: "יצרו קשר" },
      { href: "/active/sent", label: "נשלח אליהם" },
      { href: "/contacts", label: "כל אנשי הקשר" },
    ],
  },
  {
    key: "booking",
    label: "פגישות",
    icon: "calendar",
    soft: "var(--nav-pink-soft)",
    strong: "var(--nav-pink)",
    iconColor: "var(--nav-pink-icon)",
    tabs: [
      { href: "/booking", label: "סוגי פגישות" },
      { href: "/booking/calendar", label: "יומן זמינות" },
      { href: "/booking/upcoming", label: "פגישות קרובות" },
      { href: "/booking/settings", label: "הגדרות" },
    ],
  },
  {
    key: "automation",
    label: "אוטומציה",
    icon: "route",
    soft: "var(--nav-purple-soft)",
    strong: "var(--nav-purple)",
    iconColor: "var(--nav-purple-icon)",
    tabs: [
      { href: "/journeys", label: "מסעות לקוח" },
      { href: "/templates", label: "תבניות הודעה" },
      { href: "/rules", label: "כללים" },
    ],
  },
  {
    key: "newsletter",
    label: "ניוזלטר",
    icon: "mail",
    soft: "var(--nav-coral-soft)",
    strong: "var(--nav-coral)",
    iconColor: "var(--nav-coral-icon)",
    tabs: [
      { href: "/newsletter", label: "הודעה חדשה" },
      { href: "/newsletter/scheduled", label: "מתוזמנים" },
      { href: "/newsletter/history", label: "היסטוריה" },
    ],
  },
  {
    key: "events",
    label: "אירועים",
    icon: "ticket",
    soft: "var(--nav-amber-soft)",
    strong: "var(--nav-amber)",
    iconColor: "var(--nav-amber-icon)",
    tabs: [
      { href: "/events", label: "כל האירועים" },
      { href: "/events/new", label: "אירוע חדש" },
    ],
  },
  {
    key: "courses",
    label: "קורסים",
    icon: "school",
    soft: "var(--nav-blue-soft)",
    strong: "var(--nav-blue)",
    iconColor: "var(--nav-blue-icon)",
    tabs: [
      { href: "/courses", label: "כל הקורסים" },
      { href: "/courses/new", label: "קורס חדש" },
    ],
  },
  {
    key: "system",
    label: "מערכת",
    icon: "settings",
    soft: "var(--nav-gray-soft)",
    strong: "var(--nav-gray)",
    iconColor: "var(--nav-gray)",
    tabs: [
      { href: "/settings", label: "הגדרות" },
      { href: "/whatsapp", label: "וואטסאפ" },
    ],
  },
];

/**
 * התאמה לפי מקטעי נתיב ולא לפי תווים: /booking תופס את /booking/calendar
 * אבל לא את /bookings-archive.
 */
function matchesPrefix(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * לשונית שיש לה "אחות" מקוננת (/booking מול /booking/calendar) נדלקת רק
 * בהתאמה מדויקת, אחרת היא הייתה נשארת פעילה בכל עמודי המשנה. לכל השאר
 * התאמת תחילית, כדי ש-/contacts/123 ימשיך לסמן את "כל אנשי הקשר".
 */
function isTabActive(group: NavGroup, tab: NavTab, pathname: string): boolean {
  const hasNestedSibling = group.tabs.some(
    (other) => other.href !== tab.href && matchesPrefix(other.href, tab.href)
  );
  return hasNestedSibling ? pathname === tab.href : matchesPrefix(pathname, tab.href);
}

/** מסתיר את סרגלי הגלילה של הרצועות — הגלילה נשארת, רק בלי הפס. */
const HIDE_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export function DashboardNav({
  email,
  signOutAction,
}: {
  email: string | null;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();

  // דף הבית ("/") לא שייך לאף קבוצה, ולכן אין לו שורת לשוניות.
  const activeGroup = GROUPS.find((group) =>
    group.tabs.some((tab) => matchesPrefix(pathname, tab.href))
  );

  const systemGroup = GROUPS[GROUPS.length - 1];
  const systemActive = activeGroup?.key === "system";
  // הקבוצות מוצגות בשורה; המערכת יושבת בקצה כאייקון בלבד.
  const mainGroups = GROUPS.filter((group) => group.key !== "system");

  const initials = (email ?? "").slice(0, 2).toUpperCase() || "—";

  return (
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-2.5">
        {/* הלוגו הוא כפתור הבית — אין פריט "בית" נפרד בסרגל. */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-white"
          style={{ backgroundColor: "var(--nav-purple)" }}
        >
          <Icon name="home" size={14} />
          CRM
        </Link>

        {/*
          הרצועה גולשת בתוך עצמה במסך צר. בלי זה שש הקבוצות היו דוחפות את
          העמוד כולו לגלילה אופקית — וזה מזיז גם את התוכן שמתחת.
        */}
        <nav className={`flex min-w-0 flex-1 items-center gap-1 overflow-x-auto ${HIDE_SCROLLBAR}`}>
          {mainGroups.map((group) => {
            const active = activeGroup?.key === group.key;
            return (
              <Link
                key={group.key}
                href={group.tabs[0].href}
                aria-current={active ? "page" : undefined}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors duration-150"
                style={{
                  backgroundColor: active ? group.soft : undefined,
                  color: active ? group.strong : "var(--muted)",
                }}
              >
                <span style={{ color: group.iconColor }}>
                  <Icon name={group.icon} />
                </span>
                {group.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href={systemGroup.tabs[0].href}
            aria-label="הגדרות המערכת"
            aria-current={systemActive ? "page" : undefined}
            className="grid size-8 place-items-center rounded-full transition-colors duration-150"
            style={{
              backgroundColor: systemActive ? "var(--nav-gray-soft)" : undefined,
              color: systemActive ? "var(--nav-gray)" : "var(--muted)",
            }}
          >
            <Icon name="settings" />
          </Link>

          {/*
            details ולא רכיב עם state: התפריט נפתח, נסגר ונסגר-בלחיצה-בחוץ
            בלי שורת JavaScript משלנו, ובלי לגרור hook לרכיב שכל תפקידו לסמן
            נתיב.
          */}
          <details className="relative">
            <summary
              className="grid size-8 cursor-pointer list-none place-items-center rounded-full text-xs font-semibold [&::-webkit-details-marker]:hidden"
              style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
              aria-label="החשבון שלי"
            >
              {initials}
            </summary>
            <div
              className="absolute end-0 top-full z-20 mt-2 w-56 rounded-xl border bg-white p-3 shadow-lg"
              style={{ borderColor: "var(--border)" }}
            >
              <p className="truncate text-xs text-[var(--muted)]" dir="ltr">
                {email ?? "לא מחובר"}
              </p>
              <form action={signOutAction} className="mt-2">
                <button type="submit" className="btn-ghost w-full justify-start">
                  התנתקות
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>

      {/* שורת לשוניות המשנה — רק כשיש קבוצה פעילה. */}
      {activeGroup && (
        <div className="border-t border-[var(--border)] bg-[var(--background)]/60">
          <div
            className={`mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-6 py-1.5 ${HIDE_SCROLLBAR}`}
          >
            {activeGroup.tabs.map((tab) => {
              const active = isTabActive(activeGroup, tab, pathname);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "shrink-0 rounded-lg border px-3 py-1 text-sm font-medium transition-colors duration-150",
                    active
                      ? "border-[var(--border-strong)] bg-white text-[var(--foreground)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]",
                  ].join(" ")}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
