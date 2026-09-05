import Link from "next/link";

/**
 * מעטפת ההגדרות: מה שנוגעים בו פעם בחודש, מרוכז במקום אחד.
 *
 * שלושת הדפים האלה ישבו קודם בתפריט הראשי, ליד אנשי קשר ופגישות — כלומר ליד
 * מה שעושים כל יום. זה גרם לתפריט של שבעה פריטים שרובם נדירים, ודחף את מה
 * שבאמת חשוב הצידה.
 */
const TABS = [
  { href: "/settings/statuses", label: "סטטוסים" },
  { href: "/settings/fields", label: "שדות" },
  { href: "/settings/sending", label: "בלמי שליחה" },
  { href: "/settings/meta-forms", label: "טפסי מטא" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">הגדרות</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          הגדרות שמשפיעות על כל המערכת. שעות הזמינות והגדרות הפגישות נשארו תחת{" "}
          <Link href="/booking" className="underline">
            פגישות
          </Link>
          , ומצב המספר אצל Meta נמצא ב־
          <Link href="/whatsapp" className="underline">
            וואטסאפ
          </Link>
          .
        </p>
      </div>

      {/*
        קישורים ולא כפתורים: כל לשונית היא ניתוב אמיתי, כך שאפשר לשמור מועדף
        ישירות ללשונית ושהחזרה אחורה בדפדפן תעבוד כמצופה.
      */}
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-px">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-t-lg px-4 py-2 text-sm font-medium text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div>{children}</div>
    </div>
  );
}
