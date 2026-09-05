"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * מעטפת המערכת: סרגל צד קבוע מימין, סרגל עליון דק, והתוכן.
 *
 * ── למה סרגל צד ──
 * קודם הניווט היה שתי שורות בראש העמוד: שש קבוצות למעלה, לשוניות המשנה של
 * הקבוצה הפעילה מתחתן. זה עבד, אבל אכל שתי שורות מגובה כל מסך — וגובה הוא
 * מה שחסר בטבלה של אנשי קשר, לא רוחב. סרגל צד לוקח רוחב, שיש ממנו בשפע,
 * ומחזיר את הגובה לתוכן.
 *
 * בנוסף הוא מציג את לשוניות המשנה *ואת* הקבוצות בו-זמנית, בלי שאחת תדחוף
 * את השנייה. בשתי השורות אי אפשר היה לראות לאן אפשר להגיע מבלי ללחוץ קודם.
 *
 * ── למה שכפול המרקאפ במובייל ──
 * הסרגל מוצג פעמיים: פעם כעמודה קבועה מ-lg ומעלה, ופעם כמגירה נשלפת מתחת.
 * גוף הסרגל עצמו כתוב פעם אחת ומועבר לשניהם. החלופה — אלמנט אחד שמוזז
 * ב-transform — נשברת ב-RTL, כי translate-x פיזי והמגירה יושבת בצד ימין
 * דווקא. שני מיכלים סביב גוף משותף עולים כמה שורות ולא משאירים מקום לספק.
 *
 * רכיב לקוח רק בגלל usePathname ומצב המגירה. אין כאן שליפת נתונים.
 */

type IconName =
  | "home"
  | "users"
  | "calendar"
  | "route"
  | "mail"
  | "ticket"
  | "school"
  | "settings"
  | "chat"
  | "menu"
  | "close";

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
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
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
  /** רקע הפריט כשהקבוצה פעילה */
  soft: string;
  /** צבע הטקסט והאייקון כשהקבוצה פעילה */
  strong: string;
  /** צבע האייקון כשאינה פעילה — בהיר יותר, כדי שלא ימשוך לקבוצה הלא-נכונה */
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
      { href: "/newsletter/unsubscribed", label: "הסרות" },
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
];

/**
 * וואטסאפ והגדרות ישבו קודם כשתי לשוניות של קבוצת "מערכת" אחת. הן אף פעם לא
 * היו לשוניות של אותו דבר — האחת מצב ערוץ, השנייה תצורה — ולכן כאן הן שני
 * פריטים נפרדים. הנתיבים לא השתנו.
 */
const SYSTEM: { href: string; label: string; icon: IconName }[] = [
  { href: "/whatsapp", label: "וואטסאפ", icon: "chat" },
  { href: "/settings", label: "הגדרות", icon: "settings" },
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

/** מצב ערוץ הוואטסאפ בשורה אחת. נקרא בשרת ומועבר פנימה — ראו dashboard/layout. */
export type ChannelState = { tone: "ok" | "warn" | "bad"; label: string; hint: string };

const TONE_COLOR: Record<ChannelState["tone"], string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  bad: "var(--danger)",
};

export function DashboardShell({
  email,
  signOutAction,
  channel,
  children,
}: {
  email: string | null;
  signOutAction: () => Promise<void>;
  channel: ChannelState;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const activeGroup = GROUPS.find((group) =>
    group.tabs.some((tab) => matchesPrefix(pathname, tab.href))
  );
  const activeSystem = SYSTEM.find((item) => matchesPrefix(pathname, item.href));
  const activeTab = activeGroup?.tabs.find((tab) => isTabActive(activeGroup, tab, pathname));

  const crumbs = activeGroup
    ? [activeGroup.label, activeTab?.label].filter(Boolean)
    : activeSystem
      ? ["מערכת", activeSystem.label]
      : ["בית"];

  const initials = (email ?? "").slice(0, 2).toUpperCase() || "—";

  /* גוף הסרגל — נכתב פעם אחת, מוצג פעמיים (עמודה קבועה ומגירה). */
  const sidebar = (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <Link
        href="/"
        className="mb-1 flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--background)]"
      >
        <span
          className="grid size-8 shrink-0 place-items-center rounded-[10px] text-white"
          style={{ backgroundColor: "var(--primary)" }}
        >
          <Icon name="home" size={15} />
        </span>
        <span className="text-sm font-semibold">מערכת CRM</span>
      </Link>

      <nav className="flex flex-col gap-0.5" aria-label="ניווט ראשי">
        {GROUPS.map((group) => {
          const active = activeGroup?.key === group.key;
          return (
            <div key={group.key}>
              <Link
                href={group.tabs[0].href}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150"
                style={{
                  backgroundColor: active ? group.soft : undefined,
                  color: active ? group.strong : "var(--muted)",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span style={{ color: active ? group.strong : group.iconColor }}>
                  <Icon name={group.icon} />
                </span>
                {group.label}
              </Link>

              {/* לשוניות המשנה נפתחות רק תחת הקבוצה הפעילה — אחרת הסרגל היה
                  רשימה של עשרים ואחד קישורים שאי אפשר לסרוק. */}
              {active && (
                <ul className="mt-0.5 mb-1.5 ms-[19px] flex flex-col gap-px border-s border-[var(--border)] ps-3 pe-1">
                  {group.tabs.map((tab) => {
                    const tabActive = isTabActive(group, tab, pathname);
                    return (
                      <li key={tab.href}>
                        <Link
                          href={tab.href}
                          aria-current={tabActive ? "page" : undefined}
                          className={`block rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
                            tabActive
                              ? "bg-[var(--background)] font-semibold text-[var(--foreground)]"
                              : "text-[var(--subtle)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {tab.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <p className="px-2.5 pt-4 pb-1 text-[10.5px] font-medium tracking-[0.09em] text-[var(--subtle)]">
        מערכת
      </p>
      <nav className="flex flex-col gap-0.5" aria-label="ניווט מערכת">
        {SYSTEM.map((item) => {
          const active = activeSystem?.href === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150"
              style={{
                backgroundColor: active ? "var(--nav-gray-soft)" : undefined,
                color: active ? "var(--foreground)" : "var(--muted)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ color: active ? "var(--foreground)" : "var(--subtle)" }}>
                <Icon name={item.icon} />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <ThemeToggle />

        {/*
          מצב הערוץ קבוע מול העין בכל מסך. מתג ההשהיה חוסם שליחה בשקט — הוא
          הדבר היחיד במערכת שיכול להיות שבור בלי שאף מסך יצעק — ולכן הוא
          יושב כאן ולא רק בעמוד הוואטסאפ.
        */}
        <Link
          href="/whatsapp"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 transition-colors hover:border-[var(--border-strong)]"
        >
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: TONE_COLOR[channel.tone],
              boxShadow: `0 0 0 3px color-mix(in srgb, ${TONE_COLOR[channel.tone]} 18%, transparent)`,
            }}
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">{channel.label}</span>
            <span className="block truncate text-[10.5px] text-[var(--subtle)]">
              {channel.hint}
            </span>
          </span>
        </Link>

        <details className="group relative">
          <summary
            className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-[var(--background)] [&::-webkit-details-marker]:hidden"
            aria-label="החשבון שלי"
          >
            <span
              className="grid size-7 shrink-0 place-items-center rounded-[9px] text-[11px] font-semibold"
              style={{ backgroundColor: "var(--primary-soft)", color: "var(--primary)" }}
            >
              {initials}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]" dir="ltr">
              {email ?? "לא מחובר"}
            </span>
          </summary>
          <div
            className="absolute inset-x-0 bottom-full z-20 mb-2 min-w-44 rounded-xl border bg-[var(--surface)] p-2 shadow-lg"
            style={{ borderColor: "var(--border)" }}
          >
            <form action={signOutAction}>
              <button type="submit" className="btn-ghost w-full justify-start">
                התנתקות
              </button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* עמודה קבועה — מ-lg ומעלה */}
      <aside
        className="sticky top-0 hidden h-screen border-e border-[var(--border)] bg-[var(--surface)] lg:block"
      >
        {sidebar}
      </aside>

      {/* מגירה — מתחת ל-lg */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="סגירת התפריט"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          {/*
            ניווט סוגר את המגירה. הבדיקה על היעד ולא על כל לחיצה, אחרת פתיחת
            תפריט החשבון שבתחתית הייתה סוגרת את המגירה מתחתיו.
          */}
          <aside
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setDrawerOpen(false);
            }}
            className="absolute inset-y-0 start-0 w-[272px] border-e border-[var(--border)] bg-[var(--surface)] shadow-2xl"
          >
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] px-4 py-2.5 backdrop-blur-sm lg:px-7">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="פתיחת התפריט"
            aria-expanded={drawerOpen}
            className="grid size-8 place-items-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] lg:hidden"
          >
            <Icon name="menu" />
          </button>

          <nav aria-label="מיקום" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            {crumbs.map((crumb, i) => (
              <span key={crumb} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[var(--subtle)]">›</span>}
                <span
                  className={
                    i === crumbs.length - 1
                      ? "truncate font-semibold"
                      : "truncate text-[var(--muted)]"
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-7 lg:px-7">{children}</main>
      </div>
    </div>
  );
}
