import { utcToZonedParts, zonedTimeToUtc } from "@/lib/booking/timezone";
import { listAvailability, getBookingSettings } from "@/lib/booking/data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CSSProperties } from "react";

/**
 * רשת הזמינות של השבוע.
 *
 * עד עכשיו התשובה ל"מה פנוי אצלי ביום רביעי" דרשה לקרוא רשימת חלונות
 * ולהצליב אותה מול רשימת פגישות. כאן זה מבט אחד: מה פתוח להזמנה, מה כבר
 * נתפס, ומי תפס אותו.
 *
 * **מה שהרשת לא מראה, בכוונה:** מה שתפוס ביומן גוגל. הנתון הזה דורש קריאת
 * רשת לכל טעינת עמוד, והוא כבר נלקח בחשבון במקום שבו זה באמת קובע — בשעות
 * שהדף הציבורי מציע ללקוח. רשת שמראה "פנוי" על משבצת שגוגל חוסמת הייתה
 * משקרת; לכן היא מראה רק את מה שהמערכת עצמה יודעת בוודאות.
 */

const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** שעה עגולה אחת. הרשת מדברת בשעות, לא בדקות — היא לסריקה, לא להזמנה. */
const HOUR = 60;

export async function WeekAvailability() {
  // שולף את אזור הזמן בעצמו ולא מקבל אותו כ-prop: הדף שמארח אותו לא צריך
  // את ההגדרות לשום דבר אחר, ואין סיבה להכריח אותו לשלוף אותן.
  const { timezone: timeZone } = await getBookingSettings();
  const now = new Date();
  const { year, month, day, weekday } = utcToZonedParts(now, timeZone);

  // ראשון של השבוע הנוכחי עד מוצאי שבת, בשעון ההזמנות.
  const weekStart = zonedTimeToUtc(year, month, day - weekday, 0, timeZone);
  const weekEnd = zonedTimeToUtc(year, month, day - weekday + 7, 0, timeZone);

  // שאילתה ישירה ולא listConfirmedBookings: זו האחרונה מחזירה מזהים וזמנים
  // בלבד, והיא משמשת את חישוב השעות הפנויות בדף ההזמנה הציבורי. הוספת
  // עמודה שם בשביל תצוגה פנימית היא נגיעה בזרימה שאין סיבה לגעת בה.
  const [availability, { data: bookingsRaw }] = await Promise.all([
    listAvailability(),
    supabaseAdmin()
      .from("bookings")
      .select("id, starts_at, invitee_name")
      .eq("status", "confirmed")
      .gte("starts_at", weekStart.toISOString())
      .lt("starts_at", weekEnd.toISOString()),
  ]);
  const bookings = bookingsRaw ?? [];

  if (!availability.length) {
    return (
      <section className="card flex flex-col p-0">
        <Header />
        <div className="card-b">
          <p className="py-2 text-sm text-[var(--muted)]">
            עוד לא הוגדרו שעות זמינות, ולכן אין מה להציע ללקוח. מגדירים אותן ב
            <span className="font-medium"> יומן זמינות</span>.
          </p>
        </div>
      </section>
    );
  }

  // גבולות הרשת נגזרים מהזמינות עצמה: אין טעם להציג שבע לפנות בוקר למי
  // שמתחיל בתשע.
  const from = Math.floor(Math.min(...availability.map((a) => a.start_minute)) / HOUR);
  const to = Math.ceil(Math.max(...availability.map((a) => a.end_minute)) / HOUR);
  const hours = Array.from({ length: Math.max(1, to - from) }, (_, i) => from + i);

  /** האם המשבצת פתוחה להזמנה. */
  const isFree = (wd: number, hour: number) =>
    availability.some(
      (a) => a.weekday === wd && a.start_minute < (hour + 1) * HOUR && a.end_minute > hour * HOUR
    );

  /** מי תפס את המשבצת, אם מישהו. */
  const bookedBy = (wd: number, hour: number) => {
    for (const b of bookings) {
      const at = new Date(b.starts_at);
      const p = utcToZonedParts(at, timeZone);
      const bookedWeekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
      if (bookedWeekday === wd && Math.floor(p.minutes / HOUR) === hour) {
        return b.invitee_name;
      }
    }
    return null;
  };

  return (
    <section className="card flex flex-col p-0">
      <Header />
      <div className="card-b">
        <div
          className="grid gap-px overflow-hidden rounded-xl border text-center"
          style={{
            gridTemplateColumns: `2.75rem repeat(7, minmax(0, 1fr))`,
            backgroundColor: "var(--border)",
            borderColor: "var(--border)",
          }}
        >
          <Cell head />
          {DAYS.map((d, i) => (
            <Cell key={d} head today={i === weekday}>
              {d}
            </Cell>
          ))}

          {hours.map((hour) => (
            <Row key={hour} hour={hour} isFree={isFree} bookedBy={bookedBy} />
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-[var(--muted)]">
          <Legend color="var(--primary-soft)" label="פנוי להזמנה" />
          <Legend color="var(--nav-pink-soft)" label="פגישה שנקבעה" />
          <Legend color="var(--surface-sunken)" label="מחוץ לשעות" />
        </div>
      </div>
    </section>
  );
}

function Header() {
  return (
    <div className="card-h">
      <span
        className="glyph"
        style={
          { "--glyph-color": "var(--nav-pink)", "--glyph-bg": "var(--nav-pink-soft)" } as CSSProperties
        }
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.3l3.2 2" />
        </svg>
      </span>
      <h2>זמינות · השבוע</h2>
    </div>
  );
}

function Row({
  hour,
  isFree,
  bookedBy,
}: {
  hour: number;
  isFree: (wd: number, hour: number) => boolean;
  bookedBy: (wd: number, hour: number) => string | null;
}) {
  return (
    <>
      <Cell label>{String(hour).padStart(2, "0")}</Cell>
      {DAYS.map((_, wd) => {
        const name = bookedBy(wd, hour);
        if (name) return <Cell key={wd} tone="booked">{name}</Cell>;
        return <Cell key={wd} tone={isFree(wd, hour) ? "free" : "busy"} />;
      })}
    </>
  );
}

function Cell({
  children,
  head,
  label,
  today,
  tone,
}: {
  children?: React.ReactNode;
  head?: boolean;
  label?: boolean;
  today?: boolean;
  tone?: "free" | "busy" | "booked";
}) {
  const style: CSSProperties =
    head || label
      ? { backgroundColor: "var(--background)", color: "var(--muted)" }
      : tone === "free"
        ? { backgroundColor: "var(--primary-soft)" }
        : tone === "booked"
          ? { backgroundColor: "var(--nav-pink-soft)", color: "var(--nav-pink)" }
          : { backgroundColor: "var(--surface-sunken)" };

  return (
    <div
      className={`min-h-[26px] px-1 py-1.5 text-[10.5px] ${
        head ? "font-semibold" : label ? "data text-[9.5px]" : ""
      } ${tone === "booked" ? "truncate font-semibold" : ""} ${
        today && head ? "text-[var(--primary)]" : ""
      }`}
      style={style}
    >
      {children}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i aria-hidden className="block size-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
