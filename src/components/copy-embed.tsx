"use client";

import { useEffect, useRef, useState } from "react";

/**
 * בונה את קוד ההטמעה שמדביקים בדף הנחיתה — לאירוע או לקורס.
 *
 * ── למה זה פאנל ולא כפתור ──
 * לטופס המוטמע יש שני מתגים (ראו embed-frame): איפה הוא יושב, ובאיזה צבע
 * הכפתור. מי שמדביק את הקוד הוא גם מי שרואה את דף הנחיתה, והמקום שבו הוא
 * בוחר הוא הרגע שבו הוא מעתיק — לא מסך הגדרות נפרד ולא שורת קוד. אתר חדש =
 * בוחרים צבע, מעתיקים, מדביקים.
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
const BASE_HEIGHT = { card: 470, bare: 410 };
const PER_FIELD = 85;

const DEFAULT_ACCENT = "#23392d";

/** הבחירה נשמרת בדפדפן: מי שמטמיע באתר אחד עושה את אותה בחירה בכל פעם. */
const STORAGE_KEY = "crm-embed-style";

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
  const [open, setOpen] = useState(false);
  const [bare, setBare] = useState(false);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // נקרא בפתיחת הפאנל ולא ב-effect: בשרת אין localStorage, קריאה תוך כדי
  // רינדור הייתה מייצרת HTML אחד בשרת ואחר בלקוח, ו-effect שקורא ומעדכן
  // state גורר רינדור מדורג על כל טעינת עמוד — בשביל פאנל שרוב הזמן סגור.
  const restore = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      if (typeof saved.bare === "boolean") setBare(saved.bare);
      if (/^#[0-9a-f]{6}$/i.test(saved.accent ?? "")) setAccent(saved.accent.toLowerCase());
    } catch {
      // ערך פגום או חלון פרטי — ברירות המחדל תקפות לגמרי.
    }
  };

  // סגירה בלחיצה בחוץ וב-Escape. פאנל שנשאר פתוח מאחורי שאר הכפתורים בשורה
  // חוסם אותם, וזו התנהגות שמרגישה כמו תקלה.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const config = KINDS[kind];

  const copy = async () => {
    const origin = window.location.origin;
    const height = BASE_HEIGHT[bare ? "bare" : "card"] + fieldCount * PER_FIELD;
    const domId = `${config.domPrefix}-${slug}`;

    // רק מה שנבחר נכתב. כתובת נקייה = ברירות המחדל, וזה גם מה שכבר מודבק
    // בדפי הנחיתה הקיימים.
    const query = [
      bare ? "mode=bare" : "",
      accent.toLowerCase() === DEFAULT_ACCENT ? "" : `accent=${encodeURIComponent(accent)}`,
    ]
      .filter(Boolean)
      // ‎&amp;‎ ולא ‎&‎: היעד הוא תכונת HTML, ושם ‎&‎ חשוף הוא תחילת ישות.
      // עם שני הפרמטרים הנוכחיים זה עדיין עובד, אבל פרמטר עתידי בשם שהוא
      // גם ישות (‎&copy=‎, ‎&reg=‎) היה נבלע בשקט אצל מי שכבר הדביק.
      .join("&amp;");
    const src = `${origin}/${config.path}/${slug}/embed${query ? `?${query}` : ""}`;

    // display:block ו-margin אוטומטי: ה-iframe הוא אלמנט inline, ובתוך מיכל
    // RTL הוא נצמד לימין ומשאיר חצי רצועה ריקה משמאלו. בתוך בלוק קיים אין
    // מה להגביל — הבלוק המארח כבר קובע את הרוחב.
    const frame = bare
      ? `display:block;width:100%;height:${height}px;border:0;`
      : `display:block;width:100%;max-width:440px;margin:0 auto;height:${height}px;border:0;`;

    const code = [
      `<iframe id="${domId}" src="${src}" style="${frame}" title="${config.title}"></iframe>`,
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ bare, accent }));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // דפדפן שחוסם גישה ללוח (הקשר לא מאובטח). אין מה לעשות כאן — הכפתור
      // פשוט לא יאשר, וזה עדיף על הודעת שגיאה מבלבלת.
    }
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          if (!open) restore();
          setOpen((v) => !v);
        }}
      >
        קוד הטמעה
      </button>

      {open && (
        <div className="card absolute end-0 top-full z-20 mt-2 w-[290px] p-4 shadow-[var(--shadow-3)]">
          <p className="text-sm font-semibold">איפה הטופס יושב?</p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <Choice checked={!bare} onChange={() => setBare(false)} title="כרטיס עצמאי">
              רצועה משלו בדף, עם מסגרת לבנה
            </Choice>
            <Choice checked={bare} onChange={() => setBare(true)} title="בתוך בלוק קיים">
              בלי מסגרת — נשפך לתוך הכרטיס שלך
            </Choice>
          </div>

          <label className="field-label mt-4">
            צבע הכפתור
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="size-9 shrink-0 cursor-pointer rounded-lg border border-[var(--border-strong)] bg-transparent p-1"
                aria-label="בחירת צבע הכפתור"
              />
              <input
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                onBlur={(e) =>
                  setAccent(
                    /^#?[0-9a-f]{6}$/i.test(e.target.value.trim())
                      ? `#${e.target.value.trim().replace("#", "").toLowerCase()}`
                      : DEFAULT_ACCENT
                  )
                }
                className="input data w-full"
                dir="ltr"
                maxLength={7}
              />
            </span>
          </label>

          <button type="button" className="btn-primary mt-4 w-full" onClick={copy}>
            {copied ? "הועתק ✓" : "העתקת הקוד"}
          </button>
        </div>
      )}
    </div>
  );
}

function Choice({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors"
      style={{
        borderColor: checked ? "var(--primary)" : "var(--border)",
        backgroundColor: checked ? "var(--primary-soft)" : "transparent",
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-[var(--muted)]">{children}</span>
      </span>
    </label>
  );
}
