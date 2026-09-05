"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { createCourseAction, type CourseResult } from "../actions";

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
 * טופס היצירה — שלושה שדות בלבד. אחרי השמירה הפעולה מעבירה לעורך העיצוב,
 * ושם נקבע איך הדף ייראה.
 *
 * ה-slug מוצע אוטומטית מהשם אבל נשאר בשליטת המשתמש: הוא חלק מהכתובת שתישלח
 * לקהל, ושינוי שלו אחרי שהקישור כבר יצא שובר אותו.
 */
export function NewCourseForm() {
  const [state, formAction, pending] = useActionState<CourseResult | null, FormData>(
    createCourseAction,
    null
  );
  const [slug, setSlug] = useState("");

  const origin = useOrigin();

  return (
    <form action={formAction} className="card grid grid-cols-1 gap-4">
      <label className="field-label">
        שם הקורס
        <input name="name" required maxLength={160} className="input" placeholder="קורס מדיטציה" />
      </label>

      <label className="field-label">
        שם הקורס בכתובת
        {/* התחילית מוצגת *בתוך* המסגרת ולא מתחתיה, כדי שיהיה ברור במבט אחד
            שממלאים כאן רק את הסוף. */}
        <span
          className="flex items-stretch overflow-hidden rounded-lg border bg-[var(--surface)] shadow-[inset_0_1px_1px_rgba(28,26,23,0.03)] focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-soft)]"
          style={{ borderColor: "var(--border-strong)" }}
          dir="ltr"
        >
          <span className="flex items-center border-e border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--subtle)] select-none">
            /course/
          </span>
          <input
            name="slug"
            required
            value={slug}
            onChange={(e) => setSlug(cleanSlug(e.target.value))}
            // מקף מוביל או עוקב מותר תוך כדי הקלדה ומנוקה כשעוזבים את השדה,
            // אחרת אי אפשר להקליד "meditation-" בדרך ל-"meditation-course".
            onBlur={() => setSlug((s) => s.replace(/^-+|-+$/g, ""))}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
            placeholder="meditation"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
        </span>
        <span className="text-xs leading-relaxed font-normal text-[var(--subtle)]">
          רק הסוף — לא צריך להדביק כאן כתובת. אותיות אנגליות קטנות, ספרות ומקפים.
          <br />
          דף ההרשמה יהיה בכתובת{" "}
          <span dir="ltr" className="font-medium text-[var(--muted)]">
            {origin}/course/{slug || "…"}
          </span>
        </span>
      </label>

      <label className="field-label">
        לינק התשלום בגרואו
        <input name="grow_link" type="url" maxLength={2000} className="input" dir="ltr" placeholder="https://" />
        <span className="text-xs font-normal text-[var(--subtle)]">
          ריק = הטופס מוביל ישר לעמוד התודה, בלי תשלום.
        </span>
      </label>

      {state && !state.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}

      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "שומר…" : "יצירה ומעבר לעיצוב הדף"}
        </button>
      </div>
    </form>
  );
}
