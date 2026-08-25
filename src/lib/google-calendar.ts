import "server-only";

import { google } from "googleapis";

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

/**
 * הזמנים התפוסים ביומנים שנבדקים, בטווח נתון.
 *
 * freeBusy ולא events.list בכוונה: הוא מחזיר רק טווחי "תפוס" מוכנים, כבר
 * מאוחדים, בלי לחשוף לאפליקציה את תוכן האירועים הפרטיים ביומן — וזה גם
 * ההבדל בין קריאה אחת לבין עימוד על כל האירועים בחודש.
 *
 * הערה על אירועים שנוצרו על ידי המערכת עצמה: הם יושבים ביומן ככל אירוע אחר,
 * ולכן freeBusy כבר סופר אותם כתפוס. אין צורך (ואסור) לחסום אותם פעמיים.
 */
export async function fetchBusyIntervals({
  timeMin,
  timeMax,
  calendarIds,
}: {
  timeMin: Date;
  timeMax: Date;
  calendarIds: string[];
}): Promise<BusyInterval[]> {
  const unique = [...new Set(calendarIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const response = await calendarClient().freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: unique.map((id) => ({ id })),
    },
  });

  const calendars = response.data.calendars ?? {};
  const intervals: BusyInterval[] = [];

  for (const [calendarId, entry] of Object.entries(calendars)) {
    // יומן שלא ניתן לקרוא (נמחק, הרשאה נשללה) מוחזר עם errors ובלי busy.
    // מדלגים עליו במקום להפיל את כל החישוב — אבל כן מדווחים ללוג, כי
    // "פתאום כל השעות פנויות" הוא בדיוק מה שקורה כשיומן שקט נופל.
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
