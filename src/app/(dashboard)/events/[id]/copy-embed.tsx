"use client";

import { useState } from "react";

/**
 * מעתיק ללוח את קוד ההטמעה שמדביקים בדף הנחיתה.
 *
 * ── למה יש כאן גם סקריפט ולא רק iframe ──
 * ל-iframe אין גובה אוטומטי. גובה קבוע נשבר ברגע שהטופס גדל — נוסף שדה,
 * הופיעה שגיאה, האירוע התמלא — והכפתור נחתך בשקט. שלוש השורות האלה מקשיבות
 * לגובה שהמסגרת מדווחת על עצמה (ראו useReportHeight ב-components/event-page)
 * ומעדכנות אותה. התוצאה: מדביקים פעם אחת, ולא נוגעים יותר.
 *
 * ── האבטחה שבצד המקבל ──
 * ההאזנה מאמתת גם את מקור ההודעה וגם את המזהה: בלי בדיקת origin, כל עמוד
 * או פרסומת שטעונים באותו דף היו יכולים לשלוח "גובה" ולמתוח את המסגרת.
 * ה-origin נצרב לקוד בזמן ההעתקה, ולכן הוא תמיד המדויק.
 */

/** גובה פתיחה סביר עד שההודעה הראשונה מגיעה — מונע קפיצה בטעינה. */
const BASE_HEIGHT = 430;
const PER_FIELD = 74;

export function CopyEmbed({ slug, fieldCount }: { slug: string; fieldCount: number }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        const origin = window.location.origin;
        const height = BASE_HEIGHT + fieldCount * PER_FIELD;
        const domId = `crm-event-${slug}`;

        const code = [
          `<iframe id="${domId}" src="${origin}/event/${slug}/embed" style="width:100%;max-width:420px;height:${height}px;border:0;" title="הרשמה לאירוע"></iframe>`,
          `<script>`,
          `window.addEventListener("message",function(e){`,
          `if(e.origin!==${JSON.stringify(origin)})return;`,
          `var d=e.data;if(!d||d.type!=="crm-event-height"||d.id!==${JSON.stringify(slug)})return;`,
          `var f=document.getElementById(${JSON.stringify(domId)});if(f)f.style.height=d.height+"px";`,
          `});`,
          `<\/script>`,
        ].join("\n");

        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // דפדפן שחוסם גישה ללוח (הקשר לא מאובטח). אין מה לעשות כאן —
          // הכפתור פשוט לא יאשר, וזה עדיף על הודעת שגיאה מבלבלת.
        }
      }}
    >
      {copied ? "הועתק ✓" : "העתקת קוד הטמעה"}
    </button>
  );
}
