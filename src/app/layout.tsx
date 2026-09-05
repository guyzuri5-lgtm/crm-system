import type { Metadata } from "next";
import { Rubik, IBM_Plex_Sans_Hebrew, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * שלוש פנים, שלושה תפקידים.
 *
 * Rubik נשאר הקול של המערכת — כותרות ומספרים גדולים. הוא חם וזוהה, וזו
 * הזהות שכבר קיימת.
 *
 * Plex Sans Hebrew נכנס לגוף הממשק. Rubik בגודל 13–14 פיקסלים, בטבלה
 * צפופה, מתחיל להתעגל ולהיטשטש; Plex רציונלי יותר ומפנה מקום לכותרת
 * לדבר.
 *
 * Plex Mono לכל נתון שנקרא משמאל לימין — טלפון, תאריך, slug, מזהה. בעברית
 * RTL מספר בתוך משפט נשבר: הדפדפן מסדר את הקטעים שלו לפי כיוון הפסקה. אות
 * מונו עם רוחב ספרה קבוע היא מה שמחזיק אותם יחד ובטור.
 */
const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
});

// לא גופן משתנה — חייב רשימת משקלים מפורשת. שלושה מספיקים לכל הממשק.
const plexHebrew = IBM_Plex_Sans_Hebrew({
  variable: "--font-plex-hebrew",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600"],
});

// בלי subset עברי: זה גופן לטיני, והוא נטען רק בשביל ספרות וסימנים.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "מערכת CRM",
  description: "ניהול לידים, וואטסאפ ומייל במקום אחד",
};

/**
 * החלת מצב התצוגה לפני הציור הראשון.
 *
 * חייב לרוץ כסקריפט חוסם ב-<head> ולא ברכיב React: רכיב רץ אחרי שהדפדפן
 * כבר צייר, ומצב כהה שנדלק שם מהבהב לבן לרגע בכל טעינת עמוד. try/catch כי
 * localStorage זורק בחלון פרטי בחלק מהדפדפנים, ואז ברירת המחדל היא המערכת.
 */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("crm-theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${rubik.variable} ${plexHebrew.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
