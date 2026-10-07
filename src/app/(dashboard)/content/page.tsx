import { verifyTeamMember } from "@/lib/dal";

export const dynamic = "force-dynamic";

/**
 * גאנט התוכן: תכנון, תזמון לאינסטגרם/פייסבוק/טיקטוק/יוטיוב דרך Zernio, ובנק
 * אוטומציות תגובה.
 *
 * הגאנט הוא אפליקציה שלמה ב-JavaScript נקי (public/content-app), עם העיצוב
 * וההתנהגות שלו — ולכן הוא יושב כאן ב-iframe ולא נכתב מחדש ב-React. הוא מאותו
 * מקור, כך שהקריאות שלו ל-/api/content/* נושאות את אותה עוגיית התחברות, וגם
 * הקבצים שלו עוברים דרך proxy.ts — מי שלא מחובר מופנה ל-/login.
 */
export default async function ContentPage() {
  await verifyTeamMember();
  return (
    <iframe
      src="/content-app/index.html"
      title="גאנט תוכן"
      className="w-full flex-1 border-0"
      style={{ minHeight: "calc(100dvh - 49px)" }}
    />
  );
}
