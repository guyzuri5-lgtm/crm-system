import type { NextConfig } from "next";

// תמונת המארח בדף ההזמנה יושבת בבאקט של Supabase, ו-next/image חוסם כל מארח
// חיצוני שלא הוצהר כאן. ה-hostname נגזר מכתובת הפרויקט ולא נכתב ליטרלית, כדי
// שהעברה לפרויקט Supabase אחר לא תדרוש עריכה של קובץ הקונפיג.
// try/catch ולא URL.parse: הקובץ הזה נטען גם על ידי גרסת Node של סביבת
// ה-build, ו-URL.parse קיים רק מ-Node 22 ומעלה. Next עצמו תומך מ-20.9.
function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

const supabaseHostname = hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL);

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // תמונת התצוגה המקדימה של בלוק יוטיוב בעורך הניוזלטר. הכתובת נבנית
      // מהמזהה בלבד, והמארח הזה מגיש רק תמונות.
      {
        protocol: "https" as const,
        hostname: "img.youtube.com",
        pathname: "/vi/**",
      },
      ...(supabaseHostname
        ? [
            {
              protocol: "https" as const,
              hostname: supabaseHostname,
              // רק הנתיב הציבורי של האחסון — לא כל כתובת בדומיין של הפרויקט.
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
    ],
  },
  experimental: {
    // ייבוא אנשי קשר עובר דרך Server Action, ותקרת הגוף שלהן היא 1MB כברירת
    // מחדל — גיליון של כמה אלפי שורות חוצה אותה ונדחה על ידי Next עוד לפני
    // שהקוד שלנו רואה אותו, עם שגיאה שלא מסבירה כלום. המגבלה המוצגת למשתמש
    // (5MB, ראו MAX_IMPORT_BYTES) חייבת להיות נמוכה מזו כדי שהיא זו שתתפוס.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
