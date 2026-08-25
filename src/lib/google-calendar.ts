import "server-only";

import { google, type calendar_v3 } from "googleapis";

import { parseDateKey, zonedTimeToUtc } from "@/lib/booking/timezone";

/**
 * חיבור ליומן גוגל: שליפת זמנים תפוסים, יצירת אירוע עם Google Meet, וביטול.
 *
 * הרשאות — הנקודה החשובה: הקובץ הזה משתמש באותם GOOGLE_CLIENT_ID ו-
 * GOOGLE_CLIENT_SECRET של שליחת המייל (src/lib/gmail.ts), אבל ה-refresh token
 * של המייל הופק עם scope של gmail.send בלבד, ולכן הוא *לא* יעבוד מול היומן.
 * שתי דרכים תקינות, ושתיהן נתמכות כאן:
 *
 *   1. (מומלץ) להפיק refresh token אחד חדש עם שני ה-scopes יחד —
 *      gmail.send + calendar — ולהחליף בו את GOOGLE_REFRESH_TOKEN. אז המייל
 *      והיומן עובדים מאותו טוקן ואין מה להגדיר כאן.
 *   2. להשאיר את טוקן המייל כמו שהוא ולהפיק טוקן נפרד ליומן, לתוך
 *      GOOGLE_CALENDAR_REFRESH_TOKEN. מה שמוגדר כאן מקבל עדיפות.
 *
 * ההוראות המלאות להפקה נמצאות ב-README (סעיף "חיבור יומן גוגל"), ויש סקריפט
 * שעושה את זה מקומית: `npm run auth:google`.
 */

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** נזרקת כשהיומן לא הוגדר, כדי שה-API יוכל להחזיר הודעה מובנת ולא 500 סתמי. */
export class CalendarNotConfiguredError extends Error {
  constructor() {
    super(
      "יומן גוגל אינו מחובר — יש להגדיר GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ו-GOOGLE_REFRESH_TOKEN עם הרשאת calendar (ראו README)."
    );
    this.name = "CalendarNotConfiguredError";
  }
}

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      (process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN)
  );
}

function calendarClient() {
  if (!isCalendarConfigured()) throw new CalendarNotConfiguredError();

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  auth.setCredentials({
    refresh_token:
      process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN,
  });

  return google.calendar({ version: "v3", auth });
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface BusyLookupOptions {
  timeMin: Date;
  timeMax: Date;
  calendarIds: string[];
  /** אזור הזמן של המערכת. דרוש רק לתיחום אירוע יום־שלם, שנשמר כתאריך בלי שעה. */
  timeZone: string;
  /**
   * האם אירוע יום־שלם ("יום הולדת של דנה", חג, תזכורת, סימון חופשה) נחשב תפוס.
   *
   * ברירת המחדל היא לא, וזו בדיוק הסיבה שהקובץ הזה כבר לא נשען על freeBusy:
   * freeBusy מחזיר אירוע כזה כבלוק תפוס של 24 שעות, ובלוק כזה מוחק יום שלם
   * של זמינות בלי שום סימן — לא ללקוח ולא למארח. רוב האירועים האלה אינם פגישות.
   */
  blockAllDayEvents: boolean;
}

/** הסטטוס המספרי של שגיאת googleapis, שמגיע פעם כ-code ופעם כ-status. */
function errorStatus(error: unknown): number | undefined {
  const candidate = error as { code?: number | string; status?: number } | null;
  const code = candidate?.code ?? candidate?.status;
  return typeof code === "string" ? Number(code) : code;
}

/** אירוע שהמארח דחה אינו תופס לו את היומן. */
function declinedBySelf(event: calendar_v3.Schema$Event): boolean {
  return (
    event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === "declined") ??
    false
  );
}

/**
 * הזמנים התפוסים ביומן אחד, לפי האירועים שבו.
 *
 * singleEvents: true מפרק סדרה חוזרת למופעים בפועל. בלי זה מוחזרת שורת הסדרה
 * עם תאריך ההתחלה המקורי בלבד, ואף מופע עתידי לא היה נספר כתפוס.
 *
 * fields מצמצם את התשובה לזמנים ולסטטוס בלבד — כותרות האירועים, התיאורים
 * ורשימות המשתתפים לא נשלפים כלל, וממילא לא נשמרים בשום מקום.
 */
async function busyFromEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  { timeMin, timeMax, timeZone, blockAllDayEvents }: Omit<BusyLookupOptions, "calendarIds">
): Promise<BusyInterval[]> {
  const intervals: BusyInterval[] = [];
  let pageToken: string | undefined;

  do {
    const response = await calendar.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      maxResults: 2500,
      pageToken,
      fields:
        "nextPageToken,items(start,end,status,transparency,attendees(self,responseStatus))",
    });

    for (const event of response.data.items ?? []) {
      // אירוע שבוטל נשאר ברשימה עם status=cancelled כשמבקשים singleEvents.
      if (event.status === "cancelled") continue;
      // "הצג אותי כפנוי" — האירוע קיים ביומן אבל מוצהר כלא־חוסם.
      if (event.transparency === "transparent") continue;
      if (declinedBySelf(event)) continue;

      // אירוע יום־שלם: start.date במקום start.dateTime. end.date הוא בלעדי
      // (יום אחד = 24 עד 25), ולכן שני התאריכים מתורגמים לחצות שלהם.
      if (event.start?.date) {
        if (!blockAllDayEvents || !event.end?.date) continue;
        const from = parseDateKey(event.start.date);
        const to = parseDateKey(event.end.date);
        if (!from || !to) continue;
        intervals.push({
          start: zonedTimeToUtc(from.year, from.month, from.day, 0, timeZone),
          end: zonedTimeToUtc(to.year, to.month, to.day, 0, timeZone),
        });
        continue;
      }

      if (!event.start?.dateTime || !event.end?.dateTime) continue;
      intervals.push({
        start: new Date(event.start.dateTime),
        end: new Date(event.end.dateTime),
      });
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return intervals;
}

/**
 * הנתיב החלופי: freeBusy, שדורש רק הרשאת "עיון בפרטי פנוי/תפוס".
 *
 * הוא לא מבחין בין סוגי אירועים ולכן חוסם גם ימים שלמים — אבל הוא עדיף
 * בהרבה על התעלמות מהיומן, שמשמעותה קביעת פגישה על גבי פגישה קיימת.
 */
async function busyFromFreeBusy(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    },
  });

  const intervals: BusyInterval[] = [];
  for (const entry of Object.values(response.data.calendars ?? {})) {
    if (entry.errors?.length) {
      console.error(
        `[booking] freeBusy failed for calendar ${calendarId}:`,
        entry.errors.map((error) => error.reason).join(", ")
      );
      continue;
    }
    for (const slot of entry.busy ?? []) {
      if (!slot.start || !slot.end) continue;
      intervals.push({ start: new Date(slot.start), end: new Date(slot.end) });
    }
  }
  return intervals;
}

/**
 * הזמנים התפוסים בכל היומנים שנבדקים, בטווח נתון.
 *
 * events.list ולא freeBusy: freeBusy מחזיר טווחי "תפוס" מוכנים אבל בלי שום
 * מידע *על* האירוע, ולכן אי אפשר בעזרתו להבחין בין פגישה אמיתית לבין אירוע
 * יום־שלם, אירוע שסומן "פנוי", או הזמנה שנדחתה. שלושת אלה חסמו כאן ימים
 * שלמים של זמינות. events.list מחזיר בדיוק את השדות שמאפשרים לסנן אותם.
 *
 * הערה על אירועים שנוצרו על ידי המערכת עצמה: הם יושבים ביומן ככל אירוע אחר
 * ולכן כבר נספרים כתפוס. אין צורך (ואסור) לחסום אותם פעמיים.
 */
export async function fetchBusyIntervals({
  timeMin,
  timeMax,
  calendarIds,
  timeZone,
  blockAllDayEvents,
}: BusyLookupOptions): Promise<BusyInterval[]> {
  const unique = [...new Set(calendarIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const calendar = calendarClient();

  const perCalendar = await Promise.all(
    unique.map(async (calendarId) => {
      try {
        return await busyFromEvents(calendar, calendarId, {
          timeMin,
          timeMax,
          timeZone,
          blockAllDayEvents,
        });
      } catch (error) {
        // יומן משותף שנחשף בהרשאת "פנוי/תפוס בלבד" מחזיר 403 על events.list.
        // רק ההרשאה נופלת כאן, לא הטוקן — ולכן זו נפילה חזרה ליומן הבודד הזה
        // ולא ויתור על כל החישוב. כל שגיאה אחרת (טוקן פג, רשת) ממשיכה למעלה.
        const status = errorStatus(error);
        if (status !== 403 && status !== 404) throw error;
        console.warn(
          `[booking] events.list denied for calendar ${calendarId} (${status}); falling back to freeBusy`
        );
        return busyFromFreeBusy(calendar, calendarId, timeMin, timeMax);
      }
    })
  );

  return perCalendar.flat();
}

export interface CreatedEvent {
  eventId: string;
  meetUrl: string | null;
  htmlLink: string | null;
}

/**
 * יצירת האירוע ביומן.
 *
 * sendUpdates: "all" — זה מה שגורם לגוגל לשלוח ללקוח את ההזמנה ליומן שלו
 * (בנפרד ממייל האישור שהמערכת שולחת בעצמה דרך Gmail).
 *
 * conferenceDataVersion: 1 — בלי הפרמטר הזה גוגל *מתעלם בשקט* מבקשת יצירת
 * ה-Meet ומחזיר אירוע בלי קישור, בלי שום שגיאה. זו התקלה הנפוצה ביותר כאן.
 */
export async function createCalendarEvent({
  calendarId,
  summary,
  description,
  start,
  end,
  timeZone,
  attendeeEmail,
  attendeeName,
  withMeet,
  location,
}: {
  calendarId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendeeEmail: string;
  attendeeName: string | null;
  withMeet: boolean;
  location?: string | null;
}): Promise<CreatedEvent> {
  const response = await calendarClient().events.insert({
    calendarId,
    conferenceDataVersion: withMeet ? 1 : 0,
    sendUpdates: "all",
    requestBody: {
      summary,
      description,
      location: location ?? undefined,
      start: { dateTime: start.toISOString(), timeZone },
      end: { dateTime: end.toISOString(), timeZone },
      attendees: [{ email: attendeeEmail, displayName: attendeeName ?? undefined }],
      ...(withMeet
        ? {
            conferenceData: {
              createRequest: {
                // מזהה שהלקוח בוחר; גוגל משתמש בו כדי לא ליצור פעמיים את אותה
                // שיחה אם הבקשה נשלחת שוב.
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }
        : {}),
    },
  });

  const event = response.data;
  const meetUrl =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
    null;

  return {
    eventId: event.id ?? "",
    meetUrl,
    htmlLink: event.htmlLink ?? null,
  };
}

/**
 * ביטול האירוע ביומן. 404/410 נבלעים בכוונה: אם האירוע כבר נמחק ידנית מהיומן,
 * הביטול במערכת עדיין צריך להצליח — המצב הסופי זהה.
 */
export async function deleteCalendarEvent({
  calendarId,
  eventId,
}: {
  calendarId: string;
  eventId: string;
}): Promise<void> {
  try {
    await calendarClient().events.delete({ calendarId, eventId, sendUpdates: "all" });
  } catch (error) {
    const status = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
    if (status === 404 || status === 410) return;
    throw error;
  }
}
