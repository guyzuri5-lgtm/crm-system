import "server-only";

import { isWhatsAppConfigured } from "@/lib/whatsapp-cloud";
import { getWhatsAppSettings, recentDeliveryFailures } from "@/lib/whatsapp-throttle";
import { ChannelBadge, type ChannelState } from "@/components/dashboard-shell";

/**
 * מצב ערוץ הוואטסאפ בסרגל הצד — כרכיב שרת עצמאי.
 *
 * ── למה זה יצא מהפריסה ──
 * קודם הפריסה של הדשבורד עשתה `await readChannel()` לפני שהחזירה משהו, וזו
 * שאילתה שיושבת על *כל* עמוד במערכת. כלומר: מסך אנשי הקשר לא יכול היה
 * להתחיל להיצייר עד ששאילתה על הגדרות הוואטסאפ חזרה — שני דברים שאין
 * ביניהם קשר. בפריסה, await חוסם הכל.
 *
 * עכשיו הפריסה מעבירה את הרכיב הזה בתוך <Suspense>: הסרגל, הניווט והתוכן
 * מצטיירים מיד, והנורה נדלקת כשהתשובה מגיעה. אף מסך אינו מחכה לה עוד.
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

export async function ChannelStatus() {
  return <ChannelBadge channel={await readChannel()} />;
}
