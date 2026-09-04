"use client";

import { useState } from "react";

/**
 * מעתיק ללוח את קוד ההטמעה שמדביקים בדף הנחיתה — לאירוע או לקורס.
 *
 * ── למה יש כאן גם סקריפט ולא רק iframe ──
 * ל-iframe אין גובה אוטומטי. גובה קבוע נשבר ברגע שהטופס גדל — נוסף שדה,
 * הופיעה שגיאה, האירוע התמלא — והכפתור נחתך בשקט. שלוש השורות האלה מקשיבות
 * לגובה שהמסגרת מדווחת על עצמה (ראו useReportHeight ב-components/registration-page)
 * ומעדכנות אותה. התוצאה: מדביקים פעם אחת, ולא נוגעים יותר.
 *
 * ── האבטחה שבצד המקבל ──
 * ההאזנה מאמתת גם את מקור ההודעה וגם את המזהה: בלי בדיקת origin, כל עמוד
 * או פרסומת שטעונים באותו דף היו יכולים לשלוח "גובה" ולמתוח את המסגרת.
 * ה-origin נצרב לקוד בזמן ההעתקה, ולכן הוא תמיד המדויק.
 *
 * ── למה סוג ההודעה נשאר "crm-event-height" גם לקורס ──
 * זהו פרוטוקול על החוט, לא שם פנימי. קוד ההטמעה של האירוע כבר מודבק בדף
 * נחיתה חי בוורדפרס, ושינוי המחרוזת כאן היה שובר את התאמת הגובה שם — בשקט,
 * ורק אצל מי שכבר הדביק. הרכיב המשותף פולט את הסוג הזה לשניהם, וזו הסיבה
 * היחידה שהשם מזכיר אירוע.
 */

/** גובה פתיחה סביר עד שההודעה הראשונה מגיעה — מונע קפיצה בטעינה. */
const BASE_HEIGHT = 430;
const PER_FIELD = 74;

const KINDS = {
  event: { path: "event", title: "הרשמה לאירוע", domPrefix: "crm-event" },
  course: { path: "course", title: "הרשמה לקורס", domPrefix: "crm-course" },
} as const;

export function CopyEmbed({
  slug,
  fieldCount,
  kind = "event",
}: {
  slug: string;
  fieldCount: number;
  kind?: keyof typeof KINDS;
}) {
  const [copied, setCopied] = useState(false);
  const config = KINDS[kind];

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        const origin = window.location.origin;
        const height = BASE_HEIGHT + fieldCount * PER_FIELD;
        const domId = `${config.domPrefix}-${slug}`;

        const code = [
          `<iframe id="${domId}" src="${origin}/${config.path}/${slug}/embed" style="width:100%;max-width:420px;height:${height}px;border:0;" title="${config.title}"></iframe>`,
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
