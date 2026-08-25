import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import {
  getBookingSettings,
  listAvailability,
  listDateOverrides,
} from "@/lib/booking/data";
import {
  addDaysToDateKey,
  hebrewWeekday,
  minutesToClock,
  parseDateKey,
} from "@/lib/booking/timezone";
import {
  addAvailabilityAction,
  addDateWindowAction,
  clearDateOverridesAction,
  deleteAvailabilityAction,
  deleteDateWindowAction,
  setDateUnavailableAction,
} from "../actions";

export const dynamic = "force-dynamic";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAY_INITIALS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

export default async function AvailabilityCalendarPage({
  searchParams,
}: PageProps<"/booking/calendar">) {
  await verifyTeamMember();

  const params = await searchParams;
  const settings = await getBookingSettings();

  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const monthParam = typeof params.month === "string" ? params.month : null;
  const [cursorYear, cursorMonth] = /^\d{4}-\d{2}$/.test(monthParam ?? "")
    ? monthParam!.split("-").map(Number)
    : todayKey.split("-").slice(0, 2).map(Number);

  const selectedDate =
    typeof params.date === "string" && parseDateKey(params.date) ? params.date : null;

  const monthStart = `${cursorYear}-${pad(cursorMonth)}-01`;
  const daysInMonth = new Date(Date.UTC(cursorYear, cursorMonth, 0)).getUTCDate();
  const monthEnd = `${cursorYear}-${pad(cursorMonth)}-${pad(daysInMonth)}`;

  const [availability, overrides] = await Promise.all([
    listAvailability(),
    // טווח רחב יותר מהחודש המוצג, כדי שהתאריך הנבחר ייקרא גם אם הוא בחודש אחר
    listDateOverrides(addDaysToDateKey(monthStart, -40), addDaysToDateKey(monthEnd, 40)),
  ]);

  const globalWeekly = availability.filter((row) => row.event_type_id === null);
  const globalOverrides = overrides.filter((row) => row.event_type_id === null);

  const overridesByDate = new Map<string, typeof globalOverrides>();
  for (const row of globalOverrides) {
    const rows = overridesByDate.get(row.override_date) ?? [];
    rows.push(row);
    overridesByDate.set(row.override_date, rows);
  }

  /** מה בתוקף בפועל לתאריך: חריגה אם יש, אחרת הדפוס השבועי. */
  function effectiveFor(dateKey: string) {
    const rows = overridesByDate.get(dateKey);
    if (rows?.length) {
      if (rows.some((row) => row.start_minute === null)) {
        return { source: "override" as const, unavailable: true, windows: [] };
      }
      return { source: "override" as const, unavailable: false, windows: rows };
    }
    const parsed = parseDateKey(dateKey)!;
    const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
    const windows = globalWeekly.filter((row) => row.weekday === weekday);
    return { source: "weekly" as const, unavailable: windows.length === 0, windows };
  }

  const leadingBlanks = new Date(Date.UTC(cursorYear, cursorMonth - 1, 1)).getUTCDay();
  const cells: (string | null)[] = Array(leadingBlanks).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${cursorYear}-${pad(cursorMonth)}-${pad(day)}`);
  }

  const prevMonth = new Date(Date.UTC(cursorYear, cursorMonth - 2, 1));
  const nextMonth = new Date(Date.UTC(cursorYear, cursorMonth, 1));
  const monthHref = (d: Date) =>
    `/booking/calendar?month=${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

  const selected = selectedDate ? effectiveFor(selectedDate) : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-[var(--muted)]">
        לחצו על יום כדי לקבוע לו שעות ידנית. יום בלי הגדרה מיוחדת נופל לשעות
        השבועיות הקבועות שלמטה.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* ── לוח החודש ─────────────────────────────────────────────── */}
        <section className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">{monthLabel(cursorYear, cursorMonth)}</h2>
            <div className="flex gap-1">
              <Link href={monthHref(prevMonth)} className="btn-ghost px-2" aria-label="חודש קודם">
                →
              </Link>
              <Link href={monthHref(nextMonth)} className="btn-ghost px-2" aria-label="חודש הבא">
                ←
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <div key={index} className="pb-1 text-center text-xs font-semibold text-[var(--subtle)]">
                {initial}
              </div>
            ))}

            {cells.map((dateKey, index) => {
              if (!dateKey) return <div key={`pad-${index}`} />;

              const state = effectiveFor(dateKey);
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === todayKey;
              const isPast = dateKey < todayKey;

              return (
                <Link
                  key={dateKey}
                  href={`/booking/calendar?month=${cursorYear}-${pad(cursorMonth)}&date=${dateKey}`}
                  className={[
                    "flex min-h-16 flex-col items-center justify-start gap-0.5 rounded-lg border p-1.5 text-center transition-colors duration-150",
                    isSelected
                      ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                      : "border-[var(--border)] hover:border-[var(--border-strong)]",
                    isPast ? "opacity-45" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-sm font-medium",
                      isToday ? "grid size-6 place-items-center rounded-full bg-[var(--foreground)] text-white" : "",
                    ].join(" ")}
                  >
                    {Number(dateKey.slice(-2))}
                  </span>

                  {state.unavailable ? (
                    <span className="text-[10px] text-[var(--subtle)]">—</span>
                  ) : (
                    <span
                      className={[
                        "text-[10px] leading-tight tabular-nums",
                        state.source === "override"
                          ? "font-semibold text-[var(--primary)]"
                          : "text-[var(--muted)]",
                      ].join(" ")}
                      dir="ltr"
                    >
                      {state.windows.slice(0, 2).map((w) => (
                        <span key={w.id} className="block">
                          {minutesToClock(w.start_minute!)}–{minutesToClock(w.end_minute!)}
                        </span>
                      ))}
                      {state.windows.length > 2 && <span className="block">+{state.windows.length - 2}</span>}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--subtle)]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-[var(--muted)]" />
              לפי השעות השבועיות
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-[var(--primary)]" />
              הוגדר ידנית ליום הזה
            </span>
            <span>— = לא זמין</span>
          </div>
        </section>

        {/* ── עורך היום הנבחר ───────────────────────────────────────── */}
        <section className="card self-start">
          {!selectedDate ? (
            <p className="text-sm text-[var(--muted)]">בחרו יום מהלוח כדי לערוך אותו.</p>
          ) : (
            <>
              <h2 className="font-medium">
                {new Intl.DateTimeFormat("he-IL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${selectedDate}T12:00:00Z`))}
              </h2>
              <p className="mt-1 text-xs text-[var(--subtle)]">
                {selected!.source === "override"
                  ? "מוגדר ידנית ליום הזה"
                  : "כרגע לפי השעות השבועיות"}
              </p>

              <div className="mt-4 flex flex-col gap-2">
                {selected!.unavailable ? (
                  <p className="rounded-lg bg-[var(--background)] px-3 py-2 text-sm text-[var(--muted)]">
                    לא זמין לפגישות ביום הזה
                  </p>
                ) : (
                  selected!.windows.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between rounded-lg bg-[var(--background)] px-3 py-2 text-sm"
                    >
                      <span className="font-medium tabular-nums" dir="ltr">
                        {minutesToClock(w.start_minute!)}–{minutesToClock(w.end_minute!)}
                      </span>
                      {selected!.source === "override" ? (
                        <form action={deleteDateWindowAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <button type="submit" className="btn-danger">
                            הסרה
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-[var(--subtle)]">שבועי</span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <form action={addDateWindowAction} className="mt-4 border-t border-[var(--border)] pt-4">
                <input type="hidden" name="override_date" value={selectedDate} />
                <div className="flex gap-2">
                  <label className="field-label flex-1">
                    משעה
                    <input type="time" name="start_time" defaultValue="09:00" required className="input" />
                  </label>
                  <label className="field-label flex-1">
                    עד שעה
                    <input type="time" name="end_time" defaultValue="17:00" required className="input" />
                  </label>
                </div>
                <button type="submit" className="btn-primary mt-3 w-full">
                  הוספת שעות ליום הזה
                </button>
                {selected!.source === "weekly" && !selected!.unavailable && (
                  <p className="mt-2 text-xs text-[var(--subtle)]">
                    שימו לב: הוספת שעות ליום הזה תחליף את השעות השבועיות שלו, ולא
                    תתווסף אליהן.
                  </p>
                )}
              </form>

              <div className="mt-3 flex flex-col gap-2">
                {!selected!.unavailable && (
                  <form action={setDateUnavailableAction}>
                    <input type="hidden" name="override_date" value={selectedDate} />
                    <button type="submit" className="btn-secondary w-full">
                      סימון היום כלא זמין
                    </button>
                  </form>
                )}
                {selected!.source === "override" && (
                  <form action={clearDateOverridesAction}>
                    <input type="hidden" name="override_date" value={selectedDate} />
                    <button type="submit" className="btn-ghost w-full">
                      חזרה לשעות השבועיות
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── ברירת המחדל השבועית ───────────────────────────────────── */}
      <section className="card">
        <h2 className="font-medium">שעות שבועיות קבועות</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          ברירת המחדל שחלה על כל יום שלא הוגדר לו משהו אחר ביומן למעלה.
        </p>

        <div className="flex flex-col gap-2">
          {WEEKDAYS.map((weekday) => {
            const rows = globalWeekly.filter((row) => row.weekday === weekday);
            return (
              <div
                key={weekday}
                className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] py-2 last:border-0"
              >
                <span className="w-16 shrink-0 text-sm font-medium">{hebrewWeekday(weekday)}</span>
                {rows.length === 0 ? (
                  <span className="text-sm text-[var(--subtle)]">לא זמין</span>
                ) : (
                  rows.map((row) => (
                    <span
                      key={row.id}
                      className="flex items-center gap-1 rounded-lg bg-[var(--primary-soft)] py-1 pr-2.5 pl-1 text-sm font-medium text-[var(--primary)] tabular-nums"
                    >
                      <span dir="ltr">
                        {minutesToClock(row.start_minute)}–{minutesToClock(row.end_minute)}
                      </span>
                      <form action={deleteAvailabilityAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          aria-label="מחיקת חלון"
                          className="grid size-5 place-items-center rounded-full hover:bg-white/70"
                        >
                          ×
                        </button>
                      </form>
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </div>

        <form
          action={addAvailabilityAction}
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-5"
        >
          <label className="field-label">
            יום
            <select name="weekday" className="input" required>
              {WEEKDAYS.map((weekday) => (
                <option key={weekday} value={weekday}>
                  {hebrewWeekday(weekday)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            משעה
            <input type="time" name="start_time" defaultValue="09:00" required className="input" />
          </label>
          <label className="field-label">
            עד שעה
            <input type="time" name="end_time" defaultValue="17:00" required className="input" />
          </label>
          <button type="submit" className="btn-primary">
            הוספת חלון שבועי
          </button>
        </form>
      </section>
    </div>
  );
}
