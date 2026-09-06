/**
 * "הוספה ליומן" — קובץ ICS וקישור ישיר ליומן גוגל.
 *
 * הליבה נכתבה במקור ב-lib/events.ts עבור אירועים, ועברה לכאן כשהפגישות
 * נזקקו לה גם הן. השכפול היה מסוכן במיוחד כאן: הבריחה והקיפול למטה הם
 * שני פרטים שמתנהגים היטב בעברית רק אם עושים אותם נכון, ועותק שני היה
 * מתוקן רק במקום אחד ביום שבו יתגלה באג.
 *
 * אין כאן שום תלות בדומיין — לא באירוע ולא בפגישה. שניהם ממירים את עצמם
 * ל-CalendarEntry, וזה כל מה שהקובץ הזה יודע.
 */

export interface CalendarEntry {
  /**
   * מזהה יציב לאירוע ביומן.
   *
   * חייב להישאר זהה בין הורדות: יומן שמקבל פעמיים את אותו UID מעדכן את
   * האירוע הקיים במקום ליצור כפילות. לכן הוא נגזר ממזהה הרשומה ולא מזמן
   * ההורדה.
   */
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  description?: string | null;
}

/** ‎"20260903T110000Z"‎ — הפורמט שגוגל ו-ICS מצפים לו. */
export function toIcsUtc(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * "הוספה ליומן Google" — קישור ישיר, בלי OAuth ובלי הרשאות.
 *
 * עובד גם למי שאינו מחובר: גוגל מבקשת התחברות ואז פותחת את הטופס. זה
 * המסלול הקצר ביותר לרוב הקהל בישראל, ולכן הוא הכפתור הראשי.
 */
export function googleCalendarUrl(entry: CalendarEntry): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: entry.title,
    dates: `${toIcsUtc(entry.start)}/${toIcsUtc(entry.end)}`,
  });
  if (entry.location) params.set("location", entry.location);
  if (entry.description) params.set("details", entry.description);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * שורה בקובץ ICS. שני דברים שהתקן דורש ושקל לפספס: תווי בקרה בטקסט חופשי
 * חייבים בריחה, ושורה ארוכה מ-75 בתים חייבת קיפול — בלעדיו חלק מהיומנים
 * פשוט חותכים את התיאור באמצע.
 */
function icsLine(name: string, value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

  const line = `${name}:${escaped}`;
  // הקיפול נמדד בבתים ולא בתווים: אות עברית היא שני בתים ב-UTF-8, ומדידה
  // בתווים הייתה מייצרת שורות כפולות מהמותר.
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    // חיתוך בגבול תו ולא בגבול בית — חצי אות עברית אינה UTF-8 תקין.
    let take = Math.min(limit, bytes.length - offset);
    while (take > 1 && (bytes[offset + take] & 0xc0) === 0x80) take -= 1;
    chunks.push(bytes.subarray(offset, offset + take).toString("utf8"));
    offset += take;
    limit = 74; // לשורות ההמשך יש רווח מוביל שנספר גם הוא
  }
  return chunks.join("\r\n ");
}

/** קובץ יומן תקני לכל מי שאינו גוגל — אאוטלוק, אפל, וכל השאר. */
export function buildIcs(entry: CalendarEntry): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CRM//Calendar//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    icsLine("UID", entry.uid),
    icsLine("DTSTAMP", toIcsUtc(new Date())),
    icsLine("DTSTART", toIcsUtc(entry.start)),
    icsLine("DTEND", toIcsUtc(entry.end)),
    icsLine("SUMMARY", entry.title),
    ...(entry.location ? [icsLine("LOCATION", entry.location)] : []),
    ...(entry.description ? [icsLine("DESCRIPTION", entry.description)] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF ולא \n — התקן דורש זאת, ואאוטלוק באמת נכשל בלעדיו.
  return `${lines.join("\r\n")}\r\n`;
}
