"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * מתג מצב בהיר / כהה.
 *
 * המצב הכהה מוגדר ב-globals.css מאז שלב 0, אבל היה כבוי: הווריאנט `dark:`
 * מקשיב ל-data-theme על <html> ולא ל-prefers-color-scheme, כדי שהוא לא
 * יידלק בזמן שמסכים עוד החזיקו bg-white ישירות ב-JSX. עכשיו כולם עברו
 * לאסימונים, ולכן אפשר להדליק.
 *
 * שלושה מצבים ולא שניים: "מערכת" הוא ברירת המחדל, והוא נשמע לשינוי בהגדרות
 * מערכת ההפעלה גם באמצע השימוש. בחירה מפורשת גוברת עליו ונשמרת.
 *
 * ההחלה הראשונית לא כאן אלא בסקריפט שרץ לפני הציור (layout.tsx) — רכיב
 * React רץ אחרי הציור הראשון, ומצב כהה שנדלק שם מהבהב לבן לרגע.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "crm-theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.style.colorScheme = dark ? "dark" : "light";
}

function Sun() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function Moon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function Auto() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 20.5h8" />
    </svg>
  );
}

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "בהיר", icon: <Sun /> },
  { value: "system", label: "לפי המערכת", icon: <Auto /> },
  { value: "dark", label: "כהה", icon: <Moon /> },
];

/**
 * הבחירה חיה ב-localStorage ולא ב-state של React.
 *
 * useSyncExternalStore ולא useState שמתמלא ב-useEffect: הערך האמיתי כבר
 * קיים בדפדפן ברגע שהסקריפט ב-<head> רץ, וטעינה שלו לתוך state אחרי הציור
 * היא בדיוק המקור להבהוב. הצילום לשרת מחזיר תמיד "system", שהוא גם מה
 * שהשרת לא יכול לדעת אחרת.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // storage נורה כשלשונית אחרת משנה את הבחירה — שתי לשוניות לא אמורות לסתור.
  addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onChange);
  };
}

function readTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const readServerTheme = (): Theme => "system";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, readServerTheme);

  // כש"מערכת" נבחר, שינוי בהגדרות מערכת ההפעלה חייב להיקלט גם באמצע השימוש.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // חלון פרטי: הבחירה לא נשמרת, אבל היא כן חלה על הפעלה הנוכחית.
    }
    apply(next);
    listeners.forEach((notify) => notify());
  }

  return (
    <div
      role="radiogroup"
      aria-label="מצב תצוגה"
      className="flex gap-0.5 rounded-lg p-0.5"
      style={{ backgroundColor: "var(--surface-sunken)" }}
    >
      {OPTIONS.map((option) => {
        const on = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={option.label}
            onClick={() => choose(option.value)}
            className="grid flex-1 place-items-center rounded-md py-1.5 transition-colors duration-150"
            style={{
              backgroundColor: on ? "var(--surface)" : "transparent",
              color: on ? "var(--primary)" : "var(--subtle)",
              boxShadow: on ? "var(--shadow-1)" : undefined,
            }}
          >
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
