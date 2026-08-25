"use client";

import { useState } from "react";

/** כפתור העתקת הקישור הציבורי. הקישור המלא נבנה בלקוח מ-window.location.origin,
 *  כדי שיהיה נכון גם בפיתוח מקומי וגם בפרודקשן בלי להגדיר כתובת בסיס. */
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // דפדפן שחוסם גישה ללוח (הקשר לא מאובטח) — הקישור מוצג כטקסט לידו
          // ממילא, אז אפשר פשוט לא לעשות כלום.
        }
      }}
    >
      {copied ? "הועתק ✓" : "העתקת קישור"}
    </button>
  );
}
