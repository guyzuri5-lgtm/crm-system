import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // ייבוא אנשי קשר עובר דרך Server Action, ותקרת הגוף שלהן היא 1MB כברירת
    // מחדל — גיליון של כמה אלפי שורות חוצה אותה ונדחה על ידי Next עוד לפני
    // שהקוד שלנו רואה אותו, עם שגיאה שלא מסבירה כלום. המגבלה המוצגת למשתמש
    // (5MB, ראו MAX_IMPORT_BYTES) חייבת להיות נמוכה מזו כדי שהיא זו שתתפוס.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
