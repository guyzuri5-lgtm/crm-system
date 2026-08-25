import "server-only";

import { normalizePhone } from "./quiz";
import { isBlankRow, parseSpreadsheet, type SheetRows } from "./spreadsheet";
import type { ContactField } from "./supabase/database.types";

/**
 * מיפוי גיליון שהמשתמש העלה לרשומות אנשי קשר.
 *
 * הזרימה היא בשני שלבים בכוונה: קודם קוראים את הקובץ ומציעים מיפוי, ואז
 * המשתמש מאשר או מתקן אותו לפני שנכתב משהו. הגרסה הראשונה ניחשה כותרות
 * וייבאה מיד — וזה נכשל בשקט על יצוא של גוגל פורמס עם הכותרת "כתובת מייל",
 * שלא הייתה ברשימת הכינויים: 77 מיילים נזרקו בלי שאף אחד ידע. ניחוש הוא
 * ברירת מחדל טובה, אבל הוא לא יכול להיות ההחלטה האחרונה.
 */

/** יעדי ייבוא מובנים. שדות מותאמים מיוצגים כ-`custom:<key>`. */
export type BuiltinImportTarget =
  | "full_name"
  | "first_name"
  | "last_name"
  | "phone"
  | "email"
  | "status"
  | "tags"
  | "notes"
  | "source";

export type ImportTarget = BuiltinImportTarget | `custom:${string}`;

const HEADER_ALIASES: Record<BuiltinImportTarget, string[]> = {
  full_name: ["שם", "שםמלא", "שםהליד", "אישקשר", "שםאישקשר", "name", "fullname", "contactname", "contact"],
  first_name: ["שםפרטי", "פרטי", "firstname", "givenname"],
  last_name: ["שםמשפחה", "משפחה", "lastname", "surname", "familyname"],
  phone: [
    "טלפון", "נייד", "טלפוןנייד", "מספרטלפון", "מספר", "מספרנייד", "פלאפון", "פלפון",
    "וואטסאפ", "ואטסאפ", "וצאפ",
    "phone", "phonenumber", "mobile", "mobilephone", "tel", "telephone", "cell", "cellphone", "whatsapp", "msisdn",
  ],
  email: [
    "מייל", "אימייל", "איימיל", "כתובתמייל", "כתובתאימייל", "כתובתדואל", "דואל", "דואראלקטרוני", "דואראלקטרוני",
    "email", "emailaddress", "mail", "mailaddress", "e-mail",
  ],
  status: ["סטטוס", "מצב", "שלב", "status", "stage"],
  tags: ["תגיות", "תגית", "קטגוריה", "tags", "tag", "labels", "label", "category"],
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

function suggestTarget(header: string, customFields: ContactField[]): ImportTarget | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  // שדה מותאם שהמשתמש הגדיר מנצח — אם הוא טרח לקרוא לשדה "עיר", עמודה
  // בשם "עיר" מתכוונת אליו ולא לניחוש כללי כלשהו.
  const custom = customFields.find((f) => normalizeHeader(f.label) === normalized);
  if (custom) return `custom:${custom.key}`;

  for (const [target, aliases] of Object.entries(HEADER_ALIASES) as [BuiltinImportTarget, string[]][]) {
    if (aliases.some((alias) => normalizeHeader(alias) === normalized)) return target;
  }
  return null;
}

// ── שלב 1: קריאה והצעת מיפוי ───────────────────────────────────────────

export interface ImportPreview {
  headers: string[];
  /** כמה השורות הראשונות, לתצוגה בלבד, כדי שהמשתמש יראה מה יש בכל עמודה */
  sample: string[][];
  /** ההצעה האוטומטית, לפי מיקום עמודה. null = לא זוהה */
  suggestion: (ImportTarget | null)[];
  dataRowCount: number;
}

export function previewSpreadsheet(
  fileName: string,
  buffer: Buffer,
  customFields: ContactField[]
): ImportPreview {
  const rows = parseSpreadsheet(fileName, buffer);
  if (!rows.length) throw new Error("הקובץ ריק");

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((r) => !isBlankRow(r));

  return {
    headers: headers.map((h) => h.trim()),
    sample: dataRows.slice(0, 5).map((row) => headers.map((_, i) => (row[i] ?? "").trim())),
    suggestion: headers.map((h) => suggestTarget(h, customFields)),
    dataRowCount: dataRows.length,
  };
}

// ── שלב 2: מיפוי לרשומות ───────────────────────────────────────────────

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
  custom: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedContactRow[];
  /** שורות שנפסלו עוד לפני הגישה ל-DB (אין פרט מזהה, כפילות בתוך הקובץ) */
  issues: { rowNumber: number; reason: string }[];
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

function readEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  // בדיקה מכוונת-רופפת: מספיק כדי לא לשמור זבל, בלי לפסול כתובות תקינות־אך־מוזרות
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
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

export function mapContactRows(
  rows: SheetRows,
  mapping: (ImportTarget | null)[],
  knownStatuses: string[]
): ParseResult {
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

    // שתי עמודות שמופו לאותו יעד: הראשונה שיש בה ערך מנצחת, במקום לשרשר
    // או להתעלם משתיהן.
    const get = (target: ImportTarget): string => {
      for (let c = 0; c < mapping.length; c++) {
        if (mapping[c] !== target) continue;
        const value = (row[c] ?? "").trim();
        if (value) return value;
      }
      return "";
    };

    const first = get("first_name");
    const last = get("last_name");
    const fullName = get("full_name") || [first, last].filter(Boolean).join(" ");

    const rawPhone = get("phone");
    const rawEmail = get("email");
    const phone = readPhone(rawPhone);
    const email = readEmail(rawEmail);

    if (!fullName && !phone && !email) {
      issues.push({
        rowNumber,
        reason:
          rawPhone || rawEmail
            ? `אין שם, והטלפון/המייל שבשורה אינם תקינים (${[rawPhone, rawEmail].filter(Boolean).join(", ")})`
            : "אין שם, טלפון או מייל בשורה",
      });
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

    const custom: Record<string, string> = {};
    for (const target of new Set(mapping.filter((m): m is `custom:${string}` => !!m?.startsWith("custom:")))) {
      const value = get(target);
      if (value) custom[target.slice("custom:".length)] = value;
    }

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
      custom,
    });
  }

  return { rows: parsed, issues };
}

/** קריאת הגיליון לשלב המיפוי — עוטף את parseSpreadsheet כדי שה-action לא ידע על הפורמטים. */
export function readSpreadsheet(fileName: string, buffer: Buffer): SheetRows {
  return parseSpreadsheet(fileName, buffer);
}
