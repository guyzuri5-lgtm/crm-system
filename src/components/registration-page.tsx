"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { formatLongDate, formatTime } from "@/lib/booking/timezone";
import type { EventCustomField } from "@/lib/supabase/database.types";

/**
 * המראה של דף ההרשמה ושל עמוד התודה — לאירועים ולקורסים גם יחד.
 *
 * ── למה זה רכיב ולא ארבעה דפים ──
 * ארבעה צרכנים מציגים בדיוק את אותו דבר: הדפים הציבוריים ב-/event/[slug]
 * וב-/course/[slug], ושתי התצוגות החיות בעורכי העיצוב. עותקים נפרדים של
 * הרינדור היו נפרדים זה מזה תוך שבוע — מה שבעל העסק רואה בעורך יפסיק להיות
 * מה שהלקוחה רואה בפועל, וזה בדיוק סוג הפער שמתגלה רק אחרי שהקהל כבר קיבל
 * את הקישור.
 *
 * לכן הכל כאן מקבל *נתונים* ולא מקורות: העורך מזרים את ה-state המקומי שלו,
 * הדף הציבורי מזרים שורה מהמסד, והמראה זהה בהגדרה.
 *
 * ── מה אופציונלי, ולמה ──
 * לקורס אין תאריך, מקום או קיבולת. השדות האלה אינם "חסרים" בו אלא חסרי
 * משמעות, ולכן הם אופציונליים בטיפוס ולא מסומנים כ-null: קורס פשוט לא
 * מספק אותם, והשורה שמציגה אותם אינה מרונדרת. אותו היגיון בכפתורי היומן.
 */

const TIMEZONE = "Asia/Jerusalem";

/** EventRow ו-CourseRow מתאימים לזה מבנית, וכך גם הטיוטות שבעורכים. */
export interface LandingDesign {
  name: string;
  subtitle: string | null;
  header_image_url: string | null;
  form_description: string | null;
  button_text: string;
  custom_fields: EventCustomField[];
  /** אירוע בלבד — קורס לא מספק אותם, ושורת התאריך לא מרונדרת */
  starts_at?: string;
  location?: string | null;
  show_datetime?: boolean;
  show_capacity?: boolean;
}

export interface ThanksDesign {
  thankyou_title: string;
  thankyou_text: string | null;
  thankyou_show_image: boolean;
  header_image_url: string | null;
  /** אירוע בלבד — בלי תאריך אין מה להוסיף ליומן */
  thankyou_show_calendar?: boolean;
}

/**
 * done ו-redirectTo ממולאים רק בהטמעה: שם ההרשמה לא מסתיימת בהפניה מהשרת,
 * אלא מחזירה ללקוח לאן ללכת. בדף העצמאי נשארת השגיאה בלבד.
 */
export type RegisterState = {
  error: string | null;
  done?: boolean;
  /** ריק = להציג תודה במקום; כתובת = לשלוח את כל החלון לתשלום */
  redirectTo?: string | null;
};

interface LandingProps {
  design: LandingDesign;
  /** null = בלי הגבלת קיבולת */
  spotsLeft: number | null;
  /**
   * הפעולה שמקבלת את הטופס. חסרה בתצוגה המקדימה — וזה גם מה שהופך אותה
   * לבלתי-שליחה, בלי לשכפל את הסימון.
   */
  action?: (state: RegisterState, formData: FormData) => Promise<RegisterState>;
}

// ── דף ההרשמה ──────────────────────────────────────────────────────────────

export function RegistrationLanding({ design, spotsLeft, action }: LandingProps) {
  const isFull = spotsLeft !== null && spotsLeft === 0;
  // בלי starts_at (כלומר קורס) אין תאריך לפרסר, ו-new Date(undefined) הוא
  // Invalid Date — כלומר validDate כבר false והשורה ממילא לא מרונדרת.
  const startsAt = design.starts_at ? new Date(design.starts_at) : null;
  const validDate = startsAt !== null && !Number.isNaN(startsAt.getTime());

  return (
    <div className="card overflow-hidden p-0">
      <Header design={design} />

      <div className="px-6 py-6 sm:px-8">
        {design.show_datetime && validDate && startsAt && (
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-[var(--muted)]">
            <span className="flex items-center gap-1.5">
              <CalendarIcon />
              {formatLongDate(startsAt, TIMEZONE)}
            </span>
            <span className="flex items-center gap-1.5">
              <ClockIcon />
              {formatTime(startsAt, TIMEZONE)}
            </span>
            {design.location && (
              <span className="flex items-center gap-1.5">
                <PinIcon />
                {design.location}
              </span>
            )}
          </div>
        )}

        {design.show_capacity && spotsLeft !== null && !isFull && (
          <p className="mt-4 text-center text-sm font-semibold text-[var(--nav-amber)]">
            נותרו {spotsLeft} מקומות
          </p>
        )}

        <div className="mx-auto mt-6 max-w-md">
          <FormCard design={design} isFull={isFull} action={action} />
        </div>
      </div>
    </div>
  );
}

/**
 * כרטיס הטופס בלבד — ההודעה על אירוע מלא, התיאור הקצר, והשדות.
 *
 * חולץ לכאן כדי שההטמעה תשתמש בו כמו שהוא. זו אותה סיבה שבגללה הדף הציבורי
 * והתצוגה החיה בעורך חולקים רכיב: הרגע שבו יש שני עותקים של טופס ההרשמה הוא
 * הרגע שבו שדה חדש נוסף לאחד ולא לשני.
 */
function FormCard({
  design,
  isFull,
  action,
  onResult,
}: {
  design: Pick<LandingDesign, "form_description" | "button_text" | "custom_fields">;
  isFull: boolean;
  action?: LandingProps["action"];
  /** ההטמעה בלבד: מה לעשות כשההרשמה חזרה בהצלחה. */
  onResult?: (state: RegisterState) => void;
}) {
  return (
    <>
      {isFull ? (
        <div className="mb-5 rounded-xl bg-[var(--nav-amber-soft)] px-4 py-3 text-center">
          <p className="text-sm font-semibold text-[var(--nav-amber)]">האירוע מלא</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            אפשר להשאיר פרטים ונעדכן אותך אם יתפנה מקום, או לקראת המפגש הבא.
          </p>
        </div>
      ) : (
        design.form_description && (
          <p className="mb-5 text-center text-sm leading-relaxed text-[var(--muted)]">
            {design.form_description}
          </p>
        )
      )}

      <RegistrationForm
        fields={design.custom_fields}
        buttonText={isFull ? "עדכנו אותי אם יתפנה מקום" : design.button_text}
        action={action}
        onResult={onResult}
      />
    </>
  );
}

/**
 * החלק העליון: תמונת רקע עם שכבת הכהיה, או צבע המותג כשאין תמונה.
 *
 * background-image ולא next/image, ובכוונה: זו תמונת רקע שנחתכת לפי גובה
 * המסך ולא נכס שצריך אופטימיזציה של ממדים, והשימוש הזה גם משחרר את התצוגה
 * המקדימה בעורך מהצורך בכתובת שעברה את remotePatterns — שם מוצגות גם תמונות
 * שהרגע הועלו.
 */
function Header({ design }: { design: Pick<LandingDesign, "name" | "subtitle" | "header_image_url"> }) {
  const hasImage = Boolean(design.header_image_url);

  return (
    <div
      className="relative bg-[var(--primary)] bg-cover bg-center px-6 py-12 text-center sm:px-8 sm:py-16"
      style={hasImage ? { backgroundImage: `url(${JSON.stringify(design.header_image_url)})` } : undefined}
    >
      {hasImage && <div className="absolute inset-0 bg-black/35" aria-hidden="true" />}

      <div className="relative">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">{design.name}</h1>
        {design.subtitle && (
          <p className="mx-auto mt-2.5 max-w-lg text-sm leading-relaxed text-white/85">
            {design.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

function RegistrationForm({
  fields,
  buttonText,
  action,
  onResult,
}: {
  fields: EventCustomField[];
  buttonText: string;
  action?: LandingProps["action"];
  onResult?: (state: RegisterState) => void;
}) {
  // ה-hook נקרא תמיד, גם בלי פעולה — כללי ה-hooks אינם מרשים לדלג עליו,
  // ופעולת החלף שלא נקראת לעולם עולה כלום.
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    action ?? (async () => ({ error: null })),
    { error: null }
  );

  // ההודעה על הצלחה מגיעה כ-state מהפעולה, וההטמעה צריכה להגיב עליה בניווט.
  // ב-effect ולא תוך כדי רינדור: ניווט הוא תופעת לוואי, ורינדור חייב להישאר טהור.
  useEffect(() => {
    if (state.done) onResult?.(state);
  }, [state, onResult]);

  const preview = !action;

  return (
    <form action={preview ? undefined : formAction} className="flex flex-col gap-3.5">
      {/* fieldset disabled ולא pointer-events-none: הוא גם מונע שליחה במקלדת,
          וגם מסמן לקוראי מסך שהתצוגה המקדימה אינה טופס אמיתי. */}
      <fieldset disabled={preview} className="contents">
        <label className="field-label">
          שם מלא
          <input name="full_name" required maxLength={120} className="input" autoComplete="name" />
        </label>

        <label className="field-label">
          טלפון
          <input
            name="phone"
            required
            maxLength={20}
            className="input"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
          />
        </label>

        <label className="field-label">
          אימייל
          <input
            name="email"
            type="email"
            required
            maxLength={160}
            className="input"
            autoComplete="email"
            dir="ltr"
          />
        </label>

        {fields.map((field) => (
          <label key={field.key} className="field-label">
            {field.label}
            {field.type === "select" ? (
              <select name={`custom_${field.key}`} className="input" defaultValue="">
                <option value="">בחרי…</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input name={`custom_${field.key}`} maxLength={500} className="input" />
            )}
          </label>
        ))}

        <button type="submit" className="btn-primary mt-1.5 w-full py-2.5" disabled={pending}>
          {pending ? "רגע…" : buttonText}
        </button>
      </fieldset>

      {state.error && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-center text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ── גרסת ההטמעה ────────────────────────────────────────────────────────────

/**
 * מדווח לדף המארח כמה גובה המסגרת צריכה, בכל פעם שהתוכן משתנה.
 *
 * ── למה זה קיים ──
 * ל-iframe אין גובה אוטומטי: הדף המארח קובע לו מספר קבוע, ואם הטופס גדל
 * (נוסף שדה, הופיעה הודעת שגיאה, האירוע התמלא) הכפתור נחתך — בשקט, בלי
 * שום סימן. מי שהדביקה את הקוד לא תדע, והטופס פשוט יפסיק להיות שליח.
 *
 * ResizeObserver ולא מדידה חד-פעמית: הגובה משתנה גם *אחרי* הטעינה — הודעת
 * שגיאה מתחת לכפתור, ומעבר למסך התודה שמקצר את התוכן דרמטית.
 *
 * ── למה מודדים את body ולא את documentElement ──
 * בתוך iframe, תיבת ה-‎<html>‎ ננעלת לגובה החלון ולא לגובה התוכן. נמדד בפועל:
 * מסגרת של 449 פיקסלים שהתוכן שלה דורש 471 — ‎documentElement‎ דיווח 449
 * ו-ResizeObserver עליו לא נורה כלל, בזמן ש-‎body‎ דיווח 471.5 נכונה. כלומר
 * האזנה ל-‎documentElement‎ הייתה משאירה בדיוק את הבאג שהמנגנון הזה נועד
 * למנוע: כפתור שנחתך בשקט.
 *
 * targetOrigin הוא "*" כי אנחנו לא יודעים באיזה דומיין הטופס מוטמע. זה בטוח
 * כאן: ההודעה מכילה מספר אחד ותו לא. הצד המקבל, לעומת זאת, כן מאמת את המקור
 * — ראו את קוד ההטמעה ב-copy-embed.tsx.
 */
function useReportHeight(embedId: string) {
  // מה שכבר דווח, כדי לא להציף את הדף המארח בהודעות זהות. ref ולא state:
  // זה אינו נתון שמרנדרים אותו, ועדכון שלו לא אמור לגרור רינדור נוסף.
  const lastSent = useRef(0);

  // בלי מערך תלויות: רץ אחרי *כל* רינדור. זה מה שתופס את השינויים שבאמת
  // משנים גובה — הודעת שגיאה שנוספה מתחת לכפתור, והמעבר למסך התודה. הבדיקה
  // מול lastSent הופכת את זה לזול: הודעה נשלחת רק כשהמספר באמת השתנה.
  useEffect(() => {
    if (window.parent === window) return; // לא בתוך מסגרת — אין למי לדווח

    const report = () => {
      // הגדול מבין השניים: body מפספס שוליים שיושבים על html, ו-html
      // מפספס תוכן שגלש מעבר לחלון. המקסימום נכון בשני המקרים.
      const height = Math.ceil(
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      );
      if (height === lastSent.current) return;
      lastSent.current = height;
      window.parent.postMessage({ type: "crm-event-height", id: embedId, height }, "*");
    };

    report();

    // ── שלוש רשתות ביטחון, כי אף אחת מהן לבדה אינה מספיקה ──
    //
    // ResizeObserver הוא המנגנון הנכון, אבל הוא לבדו מסוכן: לא הצלחתי לאמת
    // אותו בסביבת הבדיקה (הוא לא נורה שם כלל, גם לא על אלמנט רגיל), ובאג
    // שקט כאן פירושו כפתור שליחה חתוך אצל לקוחה אמיתית. לכן הוא ראשון —
    // ולא יחיד.
    const observer = new ResizeObserver(report);
    observer.observe(document.body);

    // שינוי רוחב החלון מזרים מחדש את הטופס ומשנה את גובהו.
    window.addEventListener("resize", report);

    // הגובה בטעינה אינו סופי: גופנים נטענים אחרי הרינדור הראשון ומזיזים
    // את הכל בכמה פיקסלים. שלוש מדידות דחויות מכסות את ההתייצבות בלי
    // להסתמך על אירוע שאולי לא יגיע.
    const timers = [120, 600, 1800].map((ms) => window.setTimeout(report, ms));

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      timers.forEach(window.clearTimeout);
    };
  });
}

/**
 * הטופס בלבד, להטמעה ב-iframe בתוך דף נחיתה קיים.
 *
 * בלי תמונת רקע, בלי כותרות ובלי מסגרת: הדף המארח מביא את העיצוב שלו, וכרטיס
 * לבן צף בתוכו היה נראה כמו טלאי. מה שכן נשאר — כל היכולות: השדות המותאמים,
 * זיהוי אירוע מלא, ומעבר לתשלום.
 *
 * ── הסיום, ולמה הוא לא redirect ──
 * הפניה רגילה מנווטת את ה-iframe, כלומר דף התשלום של גרואו היה נטען בתוך
 * מסגרת של 420 פיקסלים. לכן התשלום לוקח את *כל* החלון (window.top), ואילו
 * הודעת התודה מוצגת דווקא במקום — אין סיבה לגרור מישהי מדף הנחיתה שלך רק
 * כדי להגיד לה תודה.
 */
export function RegistrationEmbed({
  design,
  spotsLeft,
  action,
  thanksTitle,
  thanksText,
  embedId,
}: {
  design: Pick<LandingDesign, "form_description" | "button_text" | "custom_fields">;
  spotsLeft: number | null;
  action: NonNullable<LandingProps["action"]>;
  thanksTitle: string;
  thanksText: string | null;
  /** מזהה ההודעה לדף המארח — ה-slug. מבדיל בין כמה טפסים באותו עמוד. */
  embedId: string;
}) {
  const isFull = spotsLeft !== null && spotsLeft === 0;
  const [done, setDone] = useState(false);

  useReportHeight(embedId);

  // הניווט קורה כאן ולא בתוך הפעולה, כי רק הלקוח יכול לגעת ב-window.top.
  const handleResult = (state: RegisterState) => {
    if (!state.done) return;
    if (!state.redirectTo) {
      setDone(true);
      return;
    }
    try {
      // דפדפנים מרשים ל-iframe חוצה-מקור לנווט את החלון העליון רק בעקבות
      // פעולה של המשתמשת — וזו בדיוק לחיצה על כפתור השליחה.
      window.top!.location.href = state.redirectTo;
    } catch {
      // חסימת sandbox: עדיף לשבור לכרטיסייה חדשה מאשר לטעון דף תשלום
      // בתוך מסגרת צרה, או לא להגיע אליו בכלל.
      window.open(state.redirectTo, "_blank", "noopener");
    }
  };

  if (done) {
    return (
      <div className="px-1 py-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--primary-soft)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p className="mt-4 text-lg font-bold">{thanksTitle}</p>
        {thanksText && (
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-[var(--muted)]">
            {thanksText}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="px-1 py-1">
      {spotsLeft !== null && !isFull && (
        <p className="mb-3 text-center text-sm font-semibold text-[var(--nav-amber)]">
          נותרו {spotsLeft} מקומות
        </p>
      )}
      <FormCard design={design} isFull={isFull} action={action} onResult={handleResult} />
    </div>
  );
}

// ── עמוד התודה ─────────────────────────────────────────────────────────────

/**
 * עובד גם בכניסה ישירה מבחוץ: הוא הכתובת שגרואו מפנה אליה אחרי תשלום מוצלח,
 * ולכן אין לו גישה ל-session, לפרמטרים מהטופס או לזהות הנרשמת. כל מה שהוא
 * מציג נגזר מהאירוע בלבד.
 */
export function RegistrationThanks({
  design,
  googleUrl,
  icsUrl,
}: {
  design: ThanksDesign;
  /** חסרים בתצוגה המקדימה — הכפתורים מוצגים ואינם מקשרים לשום מקום. */
  googleUrl?: string;
  icsUrl?: string;
}) {
  const showImage = design.thankyou_show_image && Boolean(design.header_image_url);

  return (
    <div className="card overflow-hidden p-0">
      {showImage && (
        <div
          className="h-36 bg-cover bg-center sm:h-44"
          style={{ backgroundImage: `url(${JSON.stringify(design.header_image_url)})` }}
        />
      )}

      <div className="px-6 py-10 text-center sm:px-8">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--primary-soft)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-7"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <h1 className="mt-5 text-xl font-bold sm:text-2xl">{design.thankyou_title}</h1>
        {design.thankyou_text && (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed whitespace-pre-line text-[var(--muted)]">
            {design.thankyou_text}
          </p>
        )}

        {design.thankyou_show_calendar && (
          <div className="mt-7">
            <p className="text-xs font-semibold tracking-wide text-[var(--subtle)] uppercase">
              הוספה ליומן
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2.5">
              <a
                className="btn-secondary"
                href={googleUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <CalendarIcon />
                יומן Google
              </a>
              {/* download ולא target: הדפדפן צריך למסור את הקובץ ליומן המותקן,
                  לא לפתוח אותו כטקסט בלשונית. */}
              <a className="btn-secondary" href={icsUrl ?? "#"} download="event.ics">
                <DownloadIcon />
                יומן אחר
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── אייקונים ───────────────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="size-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4">
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
    </svg>
  );
}
