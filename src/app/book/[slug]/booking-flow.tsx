"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { GoogleMeetLogo } from "@/components/google-meet-badge";

/**
 * בחירת יום ושעה + טופס הפרטים, בשלושה שלבים על אותו מסך.
 *
 * השעות מגיעות מהשרת כ-ISO ומפורמטות כאן לאזור הזמן של *הלקוח*, לא של המארח.
 * זו הנקודה שהכי מבלבלת לקוחות בחו"ל, ולכן אזור הזמן שלפיו מוצגות השעות כתוב
 * במפורש מתחת לרשימה.
 */

interface DaySlots {
  date: string;
  slots: string[];
}

/** התוצאה של חודש אחד, יחד עם מפתח הבקשה שהיא שייכת לו. */
interface LoadedMonth {
  key: string;
  days: Record<string, string[]>;
  error: string | null;
}

interface Props {
  slug: string;
  durationMinutes: number;
  maxDaysAhead: number;
  hostTimeZone: string;
  isGoogleMeet: boolean;
}

const WEEKDAY_INITIALS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

// אזור הזמן של הדפדפן לא משתנה במהלך הביקור, אז אין למה להירשם. חייב להיות
// מוגדר ברמת המודול כדי שזהות הפונקציה תישאר יציבה בין רינדורים.
const subscribeToNothing = () => () => {};

/** "YYYY-MM-DD" של היום, באזור זמן נתון. en-CA הוא הלוקאל שמפרמט בדיוק כך. */
function todayKeyIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** יום בשבוע של ה-1 בחודש (0 = ראשון), לחישוב הריפוד בתחילת הרשת. */
function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function monthLabel(year: number, month: number): string {
  // התאריך נבנה ב-Date.UTC והוא סמן לוח-שנה, לא רגע בזמן — ולכן UTC.
  return new Intl.DateTimeFormat("he-IL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

export function BookingFlow({
  slug,
  durationMinutes,
  maxDaysAhead,
  hostTimeZone,
  isGoogleMeet,
}: Props) {
  // אזור הזמן של הצופה קיים רק בדפדפן. קריאה ל-Intl ישירות ברינדור הייתה
  // מייצרת HTML שונה בשרת ובלקוח (hydration mismatch), ו-setState בתוך effect
  // היה רינדור מדורג מיותר. useSyncExternalStore נועד בדיוק למקרה הזה: הוא
  // מקבל snapshot נפרד לשרת (אזור הזמן של המארח) וללקוח.
  const viewerTimeZone = useSyncExternalStore(
    subscribeToNothing,
    useCallback(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimeZone,
      [hostTimeZone]
    ),
    useCallback(() => hostTimeZone, [hostTimeZone])
  );

  const todayKey = useMemo(() => todayKeyIn(hostTimeZone), [hostTimeZone]);
  const [todayYear, todayMonth] = useMemo(() => {
    const [y, m] = todayKey.split("-");
    return [Number(y), Number(m)];
  }, [todayKey]);

  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth });
  const [loaded, setLoaded] = useState<LoadedMonth | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "form" | "done">("pick");

  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ meetUrl: string | null; start: string } | null>(null);

  const monthKey = `${cursor.year}-${pad(cursor.month)}`;
  // מפתח הבקשה כולל את ה-nonce, כדי שרענון יזום (אחרי שהשעה נתפסה) יריץ את
  // ה-effect מחדש גם כשהחודש לא השתנה.
  const requestKey = `${monthKey}#${reloadNonce}`;

  useEffect(() => {
    // דגל ביטול: תשובה של חודש שהמשתמש כבר דפדף ממנו נזרקת במקום לדרוס
    // את התוצאה החדשה יותר.
    let active = true;

    const [year, month] = monthKey.split("-").map(Number);
    const from = `${year}-${pad(month)}-01`;
    const to = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;

    // כל קריאות ה-setState נמצאות בהמשך ה-async ולא בגוף ה-effect עצמו —
    // זה מה שמונע את הרינדור המדורג שכלל set-state-in-effect מתריע עליו.
    (async () => {
      try {
        const response = await fetch(
          `/api/booking/slots?slug=${encodeURIComponent(slug)}&from=${from}&to=${to}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (!active) return;
          setLoaded({
            key: requestKey,
            days: {},
            error:
              body.error === "calendar_unavailable"
                ? "לא הצלחנו להתחבר ליומן כרגע. נסו לרענן בעוד רגע."
                : "טעינת השעות הפנויות נכשלה.",
          });
          return;
        }

        const body: { days: DaySlots[] } = await response.json();
        if (!active) return;

        const map: Record<string, string[]> = {};
        for (const day of body.days) map[day.date] = day.slots;
        setLoaded({ key: requestKey, days: map, error: null });
      } catch {
        if (!active) return;
        setLoaded({ key: requestKey, days: {}, error: "טעינת השעות הפנויות נכשלה." });
      }
    })();

    return () => {
      active = false;
    };
  }, [requestKey, monthKey, slug]);

  // נגזר, לא state: כל עוד התוצאה ששמורה אינה של הבקשה הנוכחית — אנחנו בטעינה.
  const isCurrent = loaded?.key === requestKey;
  const days = isCurrent ? loaded.days : {};
  const loading = !isCurrent;
  const loadError = isCurrent ? loaded.error : null;

  // גבול הדפדוף קדימה: אין טעם להציג חודשים שכולם מעבר לחלון ההזמנות.
  //
  // נגזר מ-todayKey (שכבר מחושב באזור הזמן של המארח) ולא מ-new Date() חדש —
  // אותה ספירת ימי לוח שהשרת עושה ב-computeSlots. maxDaysAhead=2 פירושו היום
  // ומחר, ולכן ‎-1‎: היום עצמו הוא הראשון מבין הימים הנספרים.
  const lastAllowedKey = useMemo(() => {
    const [year, month, day] = todayKey.split("-").map(Number);
    const limit = new Date(Date.UTC(year, month - 1, day + maxDaysAhead - 1));
    return `${limit.getUTCFullYear()}-${pad(limit.getUTCMonth() + 1)}`;
  }, [todayKey, maxDaysAhead]);

  const cursorKey = `${cursor.year}-${pad(cursor.month)}`;
  const canGoBack = cursorKey > `${todayYear}-${pad(todayMonth)}`;
  const canGoForward = cursorKey < lastAllowedKey;

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    });
    setSelectedDate(null);
    setSelectedSlot(null);
  }

  const grid = useMemo(() => {
    const cells: (string | null)[] = Array(firstWeekdayOfMonth(cursor.year, cursor.month)).fill(null);
    for (let day = 1; day <= daysInMonth(cursor.year, cursor.month); day++) {
      cells.push(`${cursor.year}-${pad(cursor.month)}-${pad(day)}`);
    }
    return cells;
  }, [cursor.year, cursor.month]);

  const formatSlotTime = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat("he-IL", {
        timeZone: viewerTimeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso)),
    [viewerTimeZone]
  );

  const formatSlotDate = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat("he-IL", {
        timeZone: viewerTimeZone,
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(iso)),
    [viewerTimeZone]
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSlot || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          start: selectedSlot,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          notes: form.notes || null,
          timezone: viewerTimeZone,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        // השעה נתפסה בין הטעינה לשליחה — מחזירים לבחירה עם רשימה מרועננת,
        // במקום להשאיר את הלקוח מול שעה שכבר לא קיימת.
        if (response.status === 409) {
          setSubmitError(body.error ?? "השעה נתפסה. בחרו מועד אחר.");
          setStep("pick");
          setSelectedSlot(null);
          setReloadNonce((value) => value + 1);
          return;
        }
        setSubmitError(body.error ?? "קביעת הפגישה נכשלה.");
        return;
      }

      setConfirmed({ meetUrl: body.meetUrl ?? null, start: selectedSlot });
      setStep("done");
    } catch {
      setSubmitError("קביעת הפגישה נכשלה. בדקו את החיבור ונסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── אישור ──────────────────────────────────────────────────────────────
  if (step === "done" && confirmed) {
    return (
      <div className="px-7 py-10 text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--accent-muted)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2.4" className="size-8">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-4 text-2xl font-bold">הפגישה נקבעה</h2>
        <p className="mx-auto mt-3 inline-block rounded-xl bg-[var(--accent-soft)] px-4 py-2 font-medium text-[var(--accent-strong)]">
          {formatSlotDate(confirmed.start)} · {formatSlotTime(confirmed.start)}
        </p>
        <p className="mt-3 text-sm text-[var(--subtle)]">
          שלחנו אישור למייל {form.email}, וההזמנה נוספה ליומן שלך.
        </p>
        {confirmed.meetUrl && (
          <div className="mx-auto mt-6 max-w-sm">
            {/* הכפתור בצבעי Google ולא בצבע המבטא של הדף: כאן זה כבר לא קישוט
                אלא זיהוי של היעד, והלקוח צריך לזהות מיד לאן הוא נכנס. */}
            <a
              href={confirmed.meetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#1a73e8] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[#1765cc] active:scale-[0.97]"
            >
              <span className="grid size-5 place-items-center rounded bg-white">
                <GoogleMeetLogo className="size-3.5" />
              </span>
              הצטרפות לשיחה ב-<span dir="ltr">Google Meet</span>
            </a>
            <p className="mt-2 text-xs text-[var(--subtle)]">
              הקישור שמור גם במייל האישור ובהזמנה ביומן — אין צורך לשמור אותו עכשיו.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── טופס הפרטים ────────────────────────────────────────────────────────
  if (step === "form" && selectedSlot) {
    return (
      <form onSubmit={submit} className="px-7 py-6">
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="btn-ghost -mr-2.5 mb-3"
          disabled={submitting}
        >
          <span aria-hidden>→</span> חזרה לבחירת מועד
        </button>

        <div className="rounded-xl border border-[var(--accent-muted)] bg-[var(--accent-soft)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--accent-strong)]">
            {formatSlotDate(selectedSlot)} · {formatSlotTime(selectedSlot)}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {durationMinutes} דקות · השעה לפי אזור הזמן שלך ({viewerTimeZone})
          </p>
          {/* שורה ולא כרטיס: ההסבר המלא על Meet כבר מופיע בכותרת הדף, ומה
              שנחוץ כאן הוא רק לקשור בין הקישור לבין שדה המייל שמתחת. */}
          {isGoogleMeet && (
            <p className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--accent-muted)] pt-2.5 text-xs text-[var(--muted)]">
              <GoogleMeetLogo className="size-3.5" />
              קישור לשיחה ב-<span dir="ltr">Google Meet</span> יישלח למייל שתמלאו כאן
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="field-label">
            שם מלא *
            <input
              className="input"
              required
              minLength={2}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoComplete="name"
            />
          </label>
          <label className="field-label">
            מייל *
            <input
              className="input"
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email"
              dir="ltr"
            />
          </label>
          <label className="field-label sm:col-span-2">
            טלפון
            <input
              className="input"
              type="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              autoComplete="tel"
              dir="ltr"
              placeholder="050-0000000"
            />
          </label>
          <label className="field-label sm:col-span-2">
            משהו שכדאי שאדע לפני הפגישה?
            <textarea
              className="input min-h-24 resize-y"
              maxLength={2000}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
        </div>

        {submitError && (
          <p className="mt-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {submitError}
          </p>
        )}

        <button
          type="submit"
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-on)] shadow-sm transition-[transform,background-color] duration-150 ease-out hover:bg-[var(--accent-strong)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 sm:w-auto"
          disabled={submitting}
        >
          {submitting ? "קובע פגישה…" : "אישור הפגישה"}
        </button>
      </form>
    );
  }

  // ── בחירת יום ושעה ─────────────────────────────────────────────────────
  const slotsForSelected = selectedDate ? (days[selectedDate] ?? []) : [];

  return (
    <div className="px-7 py-6">
      {submitError && (
        <p className="mb-4 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {submitError}
        </p>
      )}

      <div className="grid gap-7 md:grid-cols-[1fr_15rem]">
        {/* לוח החודש */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">{monthLabel(cursor.year, cursor.month)}</h2>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                disabled={!canGoBack}
                aria-label="חודש קודם"
                className="btn-ghost px-2 disabled:opacity-30"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                disabled={!canGoForward}
                aria-label="חודש הבא"
                className="btn-ghost px-2 disabled:opacity-30"
              >
                ←
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <div key={index} className="pb-1 text-xs font-semibold text-[var(--subtle)]">
                {initial}
              </div>
            ))}

            {grid.map((dateKey, index) => {
              if (!dateKey) return <div key={`pad-${index}`} />;

              const hasSlots = (days[dateKey]?.length ?? 0) > 0;
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === todayKey;
              const dayNumber = Number(dateKey.slice(-2));

              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={!hasSlots}
                  onClick={() => {
                    setSelectedDate(dateKey);
                    setSelectedSlot(null);
                  }}
                  className={[
                    "relative aspect-square rounded-xl text-sm font-semibold transition-[transform,background-color,color,box-shadow] duration-150 ease-out",
                    isSelected
                      ? "bg-[var(--accent)] text-[var(--accent-on)] shadow-sm"
                      : hasSlots
                        ? "cursor-pointer bg-[var(--accent-muted)] text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-[var(--accent-on)] active:scale-[0.94]"
                        : "cursor-default font-normal text-[var(--subtle)]",
                    // טבעת דקה על היום הנוכחי — נקודת עיגון בלוח, גם כשאין בו
                    // שעות פנויות ולכן הוא מוצג מעומעם.
                    isToday && !isSelected ? "ring-1 ring-[var(--accent)] ring-inset" : "",
                  ].join(" ")}
                >
                  {dayNumber}
                  {/* נקודה מתחת למספר: הצבע לבדו מבדיל בין יום פנוי לתפוס, וזה
                      לא מספיק למי שלא מבחין בין הגוונים. */}
                  {hasSlots && !isSelected && (
                    <span className="absolute inset-x-0 bottom-1.5 mx-auto size-1 rounded-full bg-[var(--accent)]" />
                  )}
                </button>
              );
            })}
          </div>

          {loading && <p className="mt-3 text-sm text-[var(--subtle)]">טוען שעות פנויות…</p>}
          {loadError && <p className="mt-3 text-sm text-[var(--danger)]">{loadError}</p>}
          {!loading && !loadError && Object.keys(days).length === 0 && (
            <p className="mt-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--muted)]">
              {/* כשהחודש הבא כבר מעבר לחלון ההזמנות, כפתור "החודש הבא" מושבת —
                  והפניה אליו הייתה שולחת את הלקוח לכפתור שלא לוחצים עליו. */}
              {canGoForward
                ? "אין שעות פנויות בחודש הזה. נסו את החודש הבא."
                : "אין כרגע שעות פנויות. נסו שוב מאוחר יותר, או פנו אלינו ישירות."}
            </p>
          )}
        </div>

        {/* השעות ביום שנבחר */}
        <div className="md:border-r md:border-[var(--border)] md:pr-6">
          {selectedDate ? (
            <>
              <h3 className="mb-1 text-sm font-semibold">
                {formatSlotDate(slotsForSelected[0] ?? `${selectedDate}T12:00:00Z`)}
              </h3>
              <p className="mb-3 text-xs text-[var(--muted)]">
                {slotsForSelected.length} שעות פנויות · {durationMinutes} דקות כל אחת
              </p>
              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pl-1">
                {slotsForSelected.map((iso) => (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => {
                      setSelectedSlot(iso);
                      setStep("form");
                      setSubmitError(null);
                    }}
                    className="w-full rounded-lg border border-[var(--accent-muted)] bg-[var(--surface)] py-2.5 text-sm font-semibold tabular-nums text-[var(--accent-strong)] shadow-sm transition-[transform,background-color,border-color] duration-150 ease-out hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--accent-on)] active:scale-[0.97]"
                  >
                    {formatSlotTime(iso)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--subtle)]">
                השעות מוצגות לפי אזור הזמן שלך
                <br />
                ({viewerTimeZone})
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-8 text-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.6"
                className="size-7"
                aria-hidden
              >
                <rect x="3" y="5" width="18" height="16" rx="3" />
                <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
              </svg>
              <p className="text-sm font-medium text-[var(--accent-strong)]">בחרו יום מהלוח</p>
              <p className="text-xs text-[var(--muted)]">
                הימים המסומנים בצבע הם הימים שנותרו בהם שעות פנויות.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
