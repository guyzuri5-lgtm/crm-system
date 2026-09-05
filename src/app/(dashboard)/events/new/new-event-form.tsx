"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { createEventAction, type EventResult } from "../actions";

/**
 * כתובת הבסיס של המערכת, בלי אי-התאמה בהידרציה.
 *
 * useSyncExternalStore ולא setState ב-effect: בשרת אין window, ולכן הצילום
 * שלו מחזיר מחרוזת ריקה, ובלקוח את הכתובת האמיתית. React יודע לגשר על ההבדל
 * הזה בעצמו — בלי רינדור נוסף ובלי אזהרה על רינדורים מדורגים.
 */
const subscribe = () => () => {};
function useOrigin(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => ""
  );
}

/**
 * ניקוי מה שהוקלד או הודבק לשדה הסיומת.
 *
 * הכתובת המלאה נתמכת בכוונה: התווית "כתובת הקישור" גרמה למשתמש להדביק את
 * כתובת האתר המלאה — התנהגות סבירה לגמרי — והתוצאה הייתה כתובת בתוך כתובת.
 * במקום להסביר לו שטעה, השדה פשוט לוקח את החלק האחרון ומתעלם מהשאר.
 */
function cleanSlug(raw: string): string {
  let value = raw.trim().toLowerCase();

  // הדבקת כתובת מלאה: יורדים לחלק האחרון שיש בו תוכן. "spiritualguy.co.il/"
  // מחזיר מחרוזת ריקה — וזה נכון: דף הבית אינו סיומת של אירוע.
  if (value.includes("/")) {
    value = value.replace(/^https?:\/\//, "");
    value = value.split("/").filter(Boolean).pop() ?? "";
    // הדביק את הדומיין בלבד — הנקודות מסגירות שזה מארח ולא סיומת.
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) value = "";
  }

  return value
    .replace(/[\s_]+/g, "-")        // רווחים וקווים תחתונים → מקפים
    .replace(/[^a-z0-9-]/g, "")     // כל השאר פשוט לא נכנס
    .replace(/-{2,}/g, "-");        // בלי מקפים כפולים
}

/**
 * טופס היצירה — שדות הבסיס בלבד. אחרי השמירה הפעולה מעבירה לעורך העיצוב,
 * ושם נקבע איך הדף ייראה.
 *
 * ה-slug מוצע אוטומטית מהשם אבל נשאר בשליטת המשתמש: הוא חלק מהכתובת שתישלח
 * לקהל, ושינוי שלו אחרי שהקישור כבר יצא שובר אותו.
 */
export function NewEventForm() {
  const [state, formAction, pending] = useActionState<EventResult | null, FormData>(
    createEventAction,
    null
  );
  const [slug, setSlug] = useState("");

  const origin = useOrigin();

  return (
    <form action={formAction} className="card grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="field-label md:col-span-2">
        שם האירוע
        <input name="name" required maxLength={160} className="input" placeholder="ערב ריפוי בצלילים" />
      </label>

      <label className="field-label md:col-span-2">
        שם האירוע בכתובת
        {/* התחילית מוצגת *בתוך* המסגרת ולא מתחתיה, כדי שיהיה ברור במבט אחד
            שממלאים כאן רק את הסוף. שדה ריק עם התווית "כתובת הקישור" הזמין
            להדביק לתוכו כתובת מלאה. */}
        <span
          className="flex items-stretch overflow-hidden rounded-lg border bg-[var(--surface)] shadow-[inset_0_1px_1px_rgba(28,26,23,0.03)] focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-soft)]"
          style={{ borderColor: "var(--border-strong)" }}
          dir="ltr"
        >
          <span className="flex items-center border-e border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--subtle)] select-none">
            /event/
          </span>
          <input
            name="slug"
            required
            value={slug}
            onChange={(e) => setSlug(cleanSlug(e.target.value))}
            // מקף מוביל או עוקב מותר תוך כדי הקלדה ומנוקה כשעוזבים את השדה,
            // אחרת אי אפשר להקליד "sound-" בדרך ל-"sound-healing".
            onBlur={() => setSlug((s) => s.replace(/^-+|-+$/g, ""))}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            placeholder="sound-healing"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
        </span>
        <span className="text-xs leading-relaxed font-normal text-[var(--subtle)]">
          רק הסוף — לא צריך להדביק כאן כתובת. אותיות אנגליות קטנות, ספרות ומקפים.
          <br />
          דף ההרשמה יהיה בכתובת{" "}
          <span dir="ltr" className="font-medium text-[var(--muted)]">
            {origin}/event/{slug || "…"}
          </span>
        </span>
      </label>

      <label className="field-label">
        תאריך
        <input name="date" type="date" required className="input" />
      </label>

      <label className="field-label">
        שעה
        <input name="time" type="time" required className="input" defaultValue="19:00" />
      </label>

      <label className="field-label">
        מיקום
        <input name="location" maxLength={300} className="input" placeholder="סטודיו, רחוב הרצל 5, תל אביב" />
      </label>

      <label className="field-label">
        מספר מקומות
        <input name="capacity" type="number" min={1} max={100000} className="input" />
        <span className="text-xs font-normal text-[var(--subtle)]">ריק = בלי הגבלה</span>
      </label>

      <label className="field-label md:col-span-2">
        לינק התשלום בגרואו
        <input name="grow_link" type="url" maxLength={2000} className="input" dir="ltr" placeholder="https://" />
        <span className="text-xs font-normal text-[var(--subtle)]">
          ריק = הטופס מוביל ישר לעמוד התודה, בלי תשלום.
        </span>
      </label>

      {/* התזכורות נקבעות במסך האירוע אחרי היצירה, לא כאן: הן דורשות בחירת
          תבנית מאושרת, ובזמן יצירת האירוע עוד אין החלטה כזו. */}

      {state && !state.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)] md:col-span-2">
          {state.error}
        </p>
      )}

      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "שומר…" : "יצירה ומעבר לעיצוב הדף"}
        </button>
      </div>
    </form>
  );
}
