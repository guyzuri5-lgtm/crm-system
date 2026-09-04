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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${rubik.variable} ${plexHebrew.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
