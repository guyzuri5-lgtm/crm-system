import "server-only";

import { normalizePhone } from "./quiz";
import { isBlankRow, parseSpreadsheet } from "./spreadsheet";

/**
 * מיפוי גיליון שהמשתמש העלה לרשומות אנשי קשר.
 *
 * הכותרות מזוהות אוטומטית לפי רשימת כינויים (עברית ואנגלית) במקום לבקש
 * מהמשתמש למפות עמודות ידנית — רשימות לידים מיוצאות מגיעות כמעט תמיד עם
 * אחת הכותרות המוכרות, ומיפוי ידני היה מוסיף מסך שלם לזרימה.
 */

export type ImportField = "full_name" | "first_name" | "last_name" | "phone" | "email" | "status" | "tags" | "notes" | "source";

const HEADER_ALIASES: Record<ImportField, string[]> = {
  full_name: ["שם", "שםמלא", "שםהליד", "אישקשר", "name", "fullname", "contactname", "contact"],
  first_name: ["שםפרטי", "firstname", "given name", "givenname"],
  last_name: ["שםמשפחה", "משפחה", "lastname", "surname", "familyname"],
  phone: ["טלפון", "נייד", "טלפוןנייד", "מספרטלפון", "מספר", "וואטסאפ", "ואטסאפ", "phone", "phonenumber", "mobile", "tel", "telephone", "cell", "whatsapp", "msisdn"],
  email: ["מייל", "אימייל", "דואל", "דואראלקטרוני", "email", "emailaddress", "mail", "e-mail"],
  status: ["סטטוס", "מצב", "שלב", "status", "stage"],
  tags: ["תגיות", "תגית", "תגיות/קטגוריה", "קטגוריה", "tags", "tag", "labels", "label", "category"],
  notes: ["הערות", "הערה", "notes", "note", "comment", "comments", "remarks"],
  source: ["מקור", "source", "leadsource", "utmsource", "channel"],
};

/** השוואת כותרות סלחנית: בלי רווחים, קווים, מרכאות, נקודתיים ובלי הבדלי רישיות. */
function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/["'׳״]/g, "")
    .replace(/[\s_\-.:]/g, "");
}

function fieldForHeader(header: string): ImportField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
    if (aliases.some((alias) => normalizeHeader(alias) === normalized)) return field;
  }
  return null;
}

export interface ParsedContactRow {
  /** מספר השורה בקובץ כפי שהמשתמש רואה אותה באקסל (1 = שורת הכותרות) */
  rowNumber: number;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  /** סטטוס שהופיע בקובץ אבל לא קיים במערכת — נשמר כדי לדווח עליו */
  unknownStatus: string | null;
  tags: string[];
  notes: string | null;
  source: string | null;
}

export interface ParseResult {
  rows: ParsedContactRow[];
  /** שורות שנפסלו עוד לפני הגישה ל-DB (אין שם, אין טלפון ואין מייל, כפילות בתוך הקובץ) */
  issues: { rowNumber: number; reason: string }[];
  mappedFields: ImportField[];
}

/**
 * אקסל שומר "0501234567" כמספר ומאבד את האפס המוביל, אז מספר בן 9 ספרות
 * שמתחיל ב-5 או ב-7 מוחזר לצורתו. גם 972 ללא + מטופל, כי כך זה יוצא
 * מ-ManyChat ומיצוא של גוגל שיטס.
 */
function readPhone(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  if (/^\d{9}$/.test(value) && /^[57]/.test(value)) value = `0${value}`;
  if (/^972\d{9}$/.test(value)) value = `0${value.slice(3)}`;
  return normalizePhone(value);
}

/**
 * אותו מספר שמור בבסיס הנתונים בשני פורמטים שונים, תלוי מאיפה הגיע:
 * ה-webhook של ManyChat שומר את מה ש-Meta שולחת (‎+972507652811‎), והשאלון
 * שומר את מה ש-normalizePhone מחזיר (‎0507652811‎). בלי להשוות את שתי הצורות,
 * ייבוא של אדם שכבר נכנס דרך ManyChat היה יוצר אותו מחדש כרשומה כפולה
 * במקום לעדכן את הקיימת.
 */
export function phoneVariants(phone: string): string[] {
  const variants = new Set([phone]);
  if (phone.startsWith("0")) variants.add(`+972${phone.slice(1)}`);
  return [...variants];
}

function readEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  // בדיקה מכוונת-רופפת: מספיק כדי לא לשמור זבל, בלי לפסול כתובות תקינות־אך־מוזרות
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function parseContactsFile(
  fileName: string,
  buffer: Buffer,
  knownStatuses: string[]
): ParseResult {
  const rows = parseSpreadsheet(fileName, buffer);
  if (!rows.length) throw new Error("הקובץ ריק");

  const header = rows[0];
  const columns = header.map(fieldForHeader);
  const mappedFields = [...new Set(columns.filter((c): c is ImportField => c !== null))];

  const hasIdentity =
    mappedFields.includes("phone") || mappedFields.includes("email") ||
    mappedFields.includes("full_name") || mappedFields.includes("first_name");

  if (!hasIdentity) {
    throw new Error(
      `לא זוהתה אף עמודה מוכרת בשורת הכותרות (${header.slice(0, 6).map((h) => h.trim() || "—").join(" | ")}). ` +
        "צריך לפחות עמודה אחת בשם 'שם', 'טלפון' או 'מייל'."
    );
  }

  const statusLookup = new Map(knownStatuses.map((s) => [normalizeHeader(s), s]));
  const parsed: ParsedContactRow[] = [];
  const issues: { rowNumber: number; reason: string }[] = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1;

    // שורה ריקה לגמרי נשמרה כדי לשמור על מספור נכון, אבל אין טעם לדווח עליה
    // כ"שורה שדולגה" — המשתמש לא כתב שם כלום.
    if (isBlankRow(row)) continue;

    const get = (field: ImportField): string => {
      const index = columns.indexOf(field);
      return index >= 0 ? (row[index] ?? "").trim() : "";
    };

    const first = get("first_name");
    const last = get("last_name");
    const fullName = get("full_name") || [first, last].filter(Boolean).join(" ");

    const phone = readPhone(get("phone"));
    const rawPhone = get("phone");
    const email = readEmail(get("email"));
    const rawEmail = get("email");

    if (!fullName && !phone && !email) {
      const reason =
        rawPhone || rawEmail
          ? `אין שם, והטלפון/המייל שבשורה אינם תקינים (${[rawPhone, rawEmail].filter(Boolean).join(", ")})`
          : "אין שם, טלפון או מייל בשורה";
      issues.push({ rowNumber, reason });
      continue;
    }

    // כפילות *בתוך הקובץ עצמו*: שתי שורות עם אותו טלפון היו מתנגשות זו בזו
    // (השנייה מעדכנת את מה שהראשונה יצרה) ומדווחות כ"עודכן" בלי סיבה נראית.
    if (phone && seenPhones.has(phone)) {
      issues.push({ rowNumber, reason: `הטלפון ${phone} כבר הופיע קודם בקובץ` });
      continue;
    }
    if (!phone && email && seenEmails.has(email)) {
      issues.push({ rowNumber, reason: `המייל ${email} כבר הופיע קודם בקובץ` });
      continue;
    }
    if (phone) seenPhones.add(phone);
    if (email) seenEmails.add(email);

    const rawStatus = get("status");
    const status = rawStatus ? (statusLookup.get(normalizeHeader(rawStatus)) ?? null) : null;

    const rawTags = get("tags");

    parsed.push({
      rowNumber,
      full_name: fullName || null,
      phone,
      email,
      status,
      unknownStatus: rawStatus && !status ? rawStatus : null,
      tags: rawTags
        ? rawTags
            .split(/[,;|]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      notes: get("notes") || null,
      source: get("source") || null,
    });
  }

  return { rows: parsed, issues, mappedFields };
}
