import Link from "next/link";
import { readWhatsAppSettings } from "@/lib/whatsapp-throttle";

/**
 * אזהרה שמופיעה במסכים שמתזמנים שליחה, כשההשהיה דלוקה.
 *
 * הכרטיס בסרגל הצד כבר מראה את מצב הערוץ, אבל הוא לא נמצא במקום שבו
 * מסתכלים *אחרי* שמתזמנים משהו. בלי האזהרה הזו ניוזלטר מתוזמן נשאר "מתוזמן"
 * לנצח, המסך אומר שהכול תקין, ואף הודעה לא יוצאת — בדיוק הכשל השקט שההשהיה
 * עצמה נועדה למנוע, רק שהוא עובר מהמנוע למסך.
 *
 * רכיב שרת שבודק בעצמו ומחזיר null כשהשליחה פעילה, כדי שאתר הקריאה יהיה
 * שורה אחת ולא תנאי.
 *
 * למה readWhatsAppSettings ולא isSendingPaused: זו האחרונה נשענת על פולבק
 * שמחזיר paused: false כשהקריאה למסד נכשלת, והרכיב היה מחזיר null — כלומר
 * *לא* מזהיר, דווקא ברגע שבו אין לאיש מושג אם השליחה עצורה. שתיקה כאן היא
 * הבטחה שהכול תקין, ואסור להבטיח את זה בלי לדעת.
 */
export async function SendingPausedNotice() {
  const { settings, degraded } = await readWhatsAppSettings();
  if (!degraded && !settings.paused) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-3 text-sm"
      style={{
        backgroundColor: "var(--warn-soft)",
        borderColor: "color-mix(in srgb, var(--warn) 30%, transparent)",
        color: "var(--warn)",
      }}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M9 5v14M15 5v14" />
      </svg>
      {degraded ? (
        <>
          <strong className="font-semibold">לא הצלחנו לקרוא את מצב השליחה.</strong>
          <span>ייתכן שההשהיה דלוקה, ואז מה שמתוזמן כאן לא ייצא. רעננו את הדף.</span>
        </>
      ) : (
        <>
          <strong className="font-semibold">השליחה האוטומטית מושהית.</strong>
          <span>מה שמתוזמן כאן לא ייצא עד שתכובה.</span>
        </>
      )}
      <Link href="/settings/sending" className="font-semibold underline underline-offset-2">
        הגדרות ← בלמי שליחה
      </Link>
    </div>
  );
}
