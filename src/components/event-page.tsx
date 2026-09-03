"use client";

import { useActionState } from "react";
import { formatLongDate, formatTime } from "@/lib/booking/timezone";
import type { EventCustomField } from "@/lib/supabase/database.types";

/**
 * המראה של דף ההרשמה לאירוע ושל עמוד התודה — במקום אחד.
 *
 * ── למה זה רכיב ולא שני דפים ──
 * שני צרכנים מציגים בדיוק את אותו דבר: הדף הציבורי ב-/event/[slug], והתצוגה
 * החיה בעורך העיצוב. שני עותקים של הרינדור היו נפרדים זה מזה תוך שבוע — מה
 * שבעל העסק רואה בעורך יפסיק להיות מה שהלקוחה רואה בפועל, וזה בדיוק סוג
 * הפער שמתגלה רק אחרי שהקהל כבר קיבל את הקישור.
 *
 * לכן הכל כאן מקבל *נתונים* ולא מקורות: העורך מזרים את ה-state המקומי שלו,
 * הדף הציבורי מזרים שורה מהמסד, והמראה זהה בהגדרה.
 */

const TIMEZONE = "Asia/Jerusalem";

/** EventRow מתאים לזה מבנית, וכך גם הטיוטה שבעורך. */
export interface EventLandingDesign {
  name: string;
  subtitle: string | null;
  starts_at: string;
  location: string | null;
  header_image_url: string | null;
  form_description: string | null;
  button_text: string;
  show_datetime: boolean;
  show_capacity: boolean;
  custom_fields: EventCustomField[];
}

export interface EventThanksDesign {
  thankyou_title: string;
  thankyou_text: string | null;
  thankyou_show_calendar: boolean;
  thankyou_show_image: boolean;
  header_image_url: string | null;
}

export type RegisterState = { error: string | null };

interface LandingProps {
  design: EventLandingDesign;
  /** null = בלי הגבלת קיבולת */
  spotsLeft: number | null;
  /**
   * הפעולה שמקבלת את הטופס. חסרה בתצוגה המקדימה — וזה גם מה שהופך אותה
   * לבלתי-שליחה, בלי לשכפל את הסימון.
   */
  action?: (state: RegisterState, formData: FormData) => Promise<RegisterState>;
}

// ── דף ההרשמה ──────────────────────────────────────────────────────────────

export function EventLanding({ design, spotsLeft, action }: LandingProps) {
  const isFull = spotsLeft !== null && spotsLeft === 0;
  const startsAt = new Date(design.starts_at);
  const validDate = !Number.isNaN(startsAt.getTime());

  return (
    <div className="card overflow-hidden p-0">
      <Header design={design} />

      <div className="px-6 py-6 sm:px-8">
        {design.show_datetime && validDate && (
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
          />
        </div>
      </div>
    </div>
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
function Header({ design }: { design: Pick<EventLandingDesign, "name" | "subtitle" | "header_image_url"> }) {
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
}: {
  fields: EventCustomField[];
  buttonText: string;
  action?: LandingProps["action"];
}) {
  // ה-hook נקרא תמיד, גם בלי פעולה — כללי ה-hooks אינם מרשים לדלג עליו,
  // ופעולת החלף שלא נקראת לעולם עולה כלום.
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    action ?? (async () => ({ error: null })),
    { error: null }
  );

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

// ── עמוד התודה ─────────────────────────────────────────────────────────────

/**
 * עובד גם בכניסה ישירה מבחוץ: הוא הכתובת שגרואו מפנה אליה אחרי תשלום מוצלח,
 * ולכן אין לו גישה ל-session, לפרמטרים מהטופס או לזהות הנרשמת. כל מה שהוא
 * מציג נגזר מהאירוע בלבד.
 */
export function EventThanks({
  design,
  googleUrl,
  icsUrl,
}: {
  design: EventThanksDesign;
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
