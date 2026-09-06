import { verifyTeamMember } from "@/lib/dal";
import { signOut } from "@/app/login/actions";
import { DashboardShell, type ChannelState } from "@/components/dashboard-shell";
import { isWhatsAppConfigured } from "@/lib/whatsapp-cloud";
import { getWhatsAppSettings, recentDeliveryFailures } from "@/lib/whatsapp-throttle";

/**
 * מצב הערוץ לסרגל הצד.
 *
 * שתי בדיקות זולות בלבד: משתני סביבה (חינם) ושורה אחת במסד. אין כאן קריאת
 * רשת ל-Meta — getPhoneNumberStatus שייכת לעמוד /whatsapp, ואסור לה לרוץ
 * בכל טעינת עמוד במערכת.
 *
 * מה שכן חייב להיות כאן: מתג ההשהיה. הוא הדבר היחיד במערכת שיכול להיות דלוק
 * בלי שאף מסך יצעק — הקרון פשוט לא שולח כלום, בשקט.
 */
async function readChannel(): Promise<ChannelState> {
  if (!isWhatsAppConfigured()) {
    return { tone: "bad", label: "הערוץ לא מוגדר", hint: "אין חיבור ל‑Meta" };
  }

  const [settings, failures] = await Promise.all([
    getWhatsAppSettings(),
    recentDeliveryFailures(),
  ]);

  if (settings.paused) {
    return { tone: "bad", label: "השליחה מושהית", hint: "הקרון אינו שולח דבר" };
  }

  // כשלי מסירה קודמים ל"פעיל". דירוג האיכות של מטא יכול להיות ירוק בזמן
  // שאף הודעה לא נמסרת — למשל תקלת חיוב — ומסך שאומר "תקין" במצב כזה גרוע
  // מכך שלא יוצג דבר. זה בדיוק הדפוס שהחזיק תקלת יומן שבוע שלם.
  if (failures.count > 0) {
    return {
      tone: "bad",
      label:
        failures.count === 1
          ? "ההודעה האחרונה לא נמסרה"
          : `${failures.count} הודעות ברצף לא נמסרו`,
      hint: failures.lastReason ?? "מטא דחתה את השליחה",
    };
  }

  return { tone: "ok", label: "הערוץ פעיל", hint: `תקרה: ${settings.daily_limit} ליום` };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [{ email }, channel] = await Promise.all([verifyTeamMember(), readChannel()]);

  return (
    <DashboardShell email={email ?? null} signOutAction={signOut} channel={channel}>
      {children}
    </DashboardShell>
  );
}
