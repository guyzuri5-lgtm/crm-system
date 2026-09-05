import Link from "next/link";
import { SettingsTabs } from "./tabs";

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
      <div className="h-page">
        <div>
        <h1>הגדרות</h1>
        <p>
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
      </div>

      <SettingsTabs tabs={TABS} />

      <div>{children}</div>
    </div>
  );
}
