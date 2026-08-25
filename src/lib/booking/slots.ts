import "server-only";

import {
  fetchBusyIntervals,
  isCalendarConfigured,
  type BusyInterval,
} from "@/lib/google-calendar";
import type {
  BookingAvailability,
  BookingDateOverride,
  BookingEventType,
} from "@/lib/supabase/database.types";
import {
  getBookingSettings,
  groupOverridesByDate,
  listBlackouts,
  listConfirmedBookings,
  listDateOverrides,
  resolveAvailability,
} from "./data";
import {
  addDaysToDateKey,
  parseDateKey,
  zonedDateKey,
  zonedTimeToUtc,
} from "./timezone";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** חפיפה של שני טווחים חצי־פתוחים [start, end). נגיעה בקצה אינה חפיפה. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export interface ComputeSlotsInput {
  eventType: BookingEventType;
  availability: BookingAvailability[];
  /** טווחים תפוסים — מיומן גוגל ומפגישות שכבר נקבעו */
  busy: BusyInterval[];
  blackouts: { starts_at: string; ends_at: string }[];
  /** חריגות לתאריך ספציפי, מקובצות לפי "YYYY-MM-DD" — ראו resolveDayWindows */
  dateOverrides?: Map<string, BookingDateOverride[]>;
  timeZone: string;
  /** מפתחות תאריך "YYYY-MM-DD" באזור הזמן, כולל שניהם */
  fromDateKey: string;
  toDateKey: string;
  now: Date;
}

/**
 * הליבה: הצלבה של כל האילוצים לרשימת שעות התחלה אפשריות.
 *
 * פונקציה טהורה בכוונה — כל הקלט מוזרק. כך אפשר לבדוק אותה בלי גוגל ובלי DB,
 * וכל התלות באזור הזמן מרוכזת ב-zonedTimeToUtc.
 */
export function computeSlots({
  eventType,
  availability,
  busy,
  blackouts,
  dateOverrides,
  timeZone,
  fromDateKey,
  toDateKey,
  now,
}: ComputeSlotsInput): Date[] {
  const durationMs = eventType.duration_minutes * MINUTE;
  const bufferBeforeMs = eventType.buffer_before_minutes * MINUTE;
  const bufferAfterMs = eventType.buffer_after_minutes * MINUTE;

  // הקצה המוקדם של החלון: התראה מוקדמת מינימלית, שנמדדת בשעות מ*עכשיו*.
  const earliest = now.getTime() + eventType.min_notice_hours * HOUR;

  // הקצה המאוחר נמדד ב*ימי לוח* ולא בשעות: max_days_ahead=2 פירושו היום ומחר
  // במלואם, ולא 48 שעות מהרגע הזה. ההבדל אינו קוסמטי — חישוב מתגלגל היה חותך
  // את היום האחרון בדיוק בשעה הנוכחית, כך שהלקוח רואה חצי יום פתוח וחצי סגור
  // בלי שום סיבה נראית לעין, והחלון היה זז עם כל רענון של הדף.
  const horizonKey = addDaysToDateKey(
    zonedDateKey(now, timeZone),
    eventType.max_days_ahead - 1
  );

  const busyRanges = busy.map((interval) => [
    interval.start.getTime(),
    interval.end.getTime(),
  ]) as [number, number][];

  const blackoutRanges = blackouts.map((blackout) => [
    new Date(blackout.starts_at).getTime(),
    new Date(blackout.ends_at).getTime(),
  ]) as [number, number][];

  // שורות זמינות מקובצות לפי יום בשבוע, כדי לא לסרוק את כל הרשימה לכל תאריך.
  const byWeekday = new Map<number, BookingAvailability[]>();
  for (const row of availability) {
    const rows = byWeekday.get(row.weekday) ?? [];
    rows.push(row);
    byWeekday.set(row.weekday, rows);
  }

  // Set ולא מערך: שתי שורות זמינות חופפות באותו יום ("9–12" ו-"11–15") היו
  // מייצרות את אותה שעת התחלה פעמיים.
  const starts = new Set<number>();

  for (
    let dateKey = fromDateKey;
    dateKey <= toDateKey;
    dateKey = addDaysToDateKey(dateKey, 1)
  ) {
    if (dateKey > horizonKey) break;

    const parsed = parseDateKey(dateKey);
    if (!parsed) break;

    const weekday = new Date(
      Date.UTC(parsed.year, parsed.month - 1, parsed.day)
    ).getUTCDay();

    // חריגה לתאריך מחליפה את הדפוס השבועי לחלוטין, ולא מתווספת אליו — ראו
    // ההסבר בסמנטיקה של 0007_booking_date_overrides.sql. שורה אחת עם שעות
    // ריקות היא "לא זמין ביום הזה", ומדלגת על היום כולו.
    const overrides = dateOverrides?.get(dateKey);
    let windows: { start_minute: number; end_minute: number }[];

    if (overrides && overrides.length > 0) {
      if (overrides.some((row) => row.start_minute === null)) continue;
      windows = overrides.map((row) => ({
        start_minute: row.start_minute as number,
        end_minute: row.end_minute as number,
      }));
    } else {
      windows = byWeekday.get(weekday) ?? [];
    }

    for (const row of windows) {
      for (
        let minute = row.start_minute;
        minute + eventType.duration_minutes <= row.end_minute;
        minute += eventType.slot_interval_minutes
      ) {
        const slotStart = zonedTimeToUtc(
          parsed.year,
          parsed.month,
          parsed.day,
          minute,
          timeZone
        ).getTime();
        const slotEnd = slotStart + durationMs;

        if (slotStart < earliest) continue;

        // הבאפרים מרחיבים את מה שצריך להיות פנוי סביב הפגישה, בלי להזיז את
        // השעה שמוצגת ללקוח.
        const guardStart = slotStart - bufferBeforeMs;
        const guardEnd = slotEnd + bufferAfterMs;

        const hitsBusy = busyRanges.some(([start, end]) =>
          overlaps(guardStart, guardEnd, start, end)
        );
        if (hitsBusy) continue;

        // חסימה ידנית נבדקת מול זמן הפגישה עצמו ולא מול הבאפרים: "חסום לי
        // 14:00–15:00" לא אמור לפסול פגישה שנגמרת ב-14:00.
        const hitsBlackout = blackoutRanges.some(([start, end]) =>
          overlaps(slotStart, slotEnd, start, end)
        );
        if (hitsBlackout) continue;

        starts.add(slotStart);
      }
    }
  }

  return [...starts].sort((a, b) => a - b).map((timestamp) => new Date(timestamp));
}

export interface DaySlots {
  /** "YYYY-MM-DD" באזור הזמן של המערכת */
  date: string;
  /** שעות התחלה כ-ISO (UTC). הלקוח מפרמט אותן לאזור הזמן שלו. */
  slots: string[];
}

export function groupSlotsByDay(slots: Date[], timeZone: string): DaySlots[] {
  const days = new Map<string, string[]>();
  for (const slot of slots) {
    const key = zonedDateKey(slot, timeZone);
    const list = days.get(key) ?? [];
    list.push(slot.toISOString());
    days.set(key, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slotList]) => ({ date, slots: slotList }));
}

/**
 * הגרסה שמושכת הכל בעצמה — זו שה-API והדף הציבורי קוראים לה.
 *
 * שימו לב לסדר: freeBusy נקרא על טווח אחד רחב ולא פר יום. זו קריאת רשת אחת
 * במקום שלושים.
 */
export async function getAvailableSlots({
  eventType,
  fromDateKey,
  toDateKey,
  now = new Date(),
}: {
  eventType: BookingEventType;
  fromDateKey: string;
  toDateKey: string;
  now?: Date;
}): Promise<{ timeZone: string; days: DaySlots[]; calendarConnected: boolean }> {
  const settings = await getBookingSettings();
  const timeZone = settings.timezone;

  const fromParsed = parseDateKey(fromDateKey);
  const toParsed = parseDateKey(toDateKey);
  if (!fromParsed || !toParsed) {
    return { timeZone, days: [], calendarConnected: isCalendarConfigured() };
  }

  // גבולות החלון לשאילתות החיצוניות: מתחילת היום הראשון ועד סוף היום האחרון
  // באזור הזמן. הבאפרים יכולים לגלוש מעבר לקצוות, ולכן מרחיבים ביום לכל צד —
  // אחרת פגישה קיימת ב-08:00 של היום הראשון לא הייתה נספרת מול באפר שלפניה.
  const windowStart = new Date(
    zonedTimeToUtc(fromParsed.year, fromParsed.month, fromParsed.day, 0, timeZone).getTime() - DAY
  );
  const windowEnd = new Date(
    zonedTimeToUtc(toParsed.year, toParsed.month, toParsed.day, 1440, timeZone).getTime() + DAY
  );

  const [availability, blackouts, existingBookings, overrides] = await Promise.all([
    resolveAvailability(eventType.id),
    listBlackouts(windowStart, windowEnd),
    listConfirmedBookings(windowStart, windowEnd),
    listDateOverrides(fromDateKey, toDateKey),
  ]);

  const busy: BusyInterval[] = existingBookings.map((booking) => ({
    start: new Date(booking.starts_at),
    end: new Date(booking.ends_at),
  }));

  const calendarConnected = isCalendarConfigured();
  if (calendarConnected) {
    try {
      const googleBusy = await fetchBusyIntervals({
        timeMin: windowStart,
        timeMax: windowEnd,
        calendarIds: [settings.calendar_id, ...settings.busy_calendar_ids],
        timeZone,
        blockAllDayEvents: settings.block_all_day_events,
      });
      busy.push(...googleBusy);
    } catch (error) {
      // כשל מול גוגל הוא המקרה המסוכן: להמשיך כאילו היומן ריק יגרום להצעת
      // שעות תפוסות. עדיף להחזיר "אין זמינות" מאשר להזמין לקוח לשעה שבה
      // כבר יש פגישה אחרת.
      console.error("[booking] freeBusy lookup failed:", error);
      throw new Error("calendar_unavailable");
    }
  }

  const slots = computeSlots({
    eventType,
    availability,
    busy,
    blackouts,
    dateOverrides: groupOverridesByDate(overrides, eventType.id),
    timeZone,
    fromDateKey,
    toDateKey,
    now,
  });

  return { timeZone, days: groupSlotsByDay(slots, timeZone), calendarConnected };
}
