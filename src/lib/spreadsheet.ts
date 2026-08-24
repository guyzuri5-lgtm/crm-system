import "server-only";

import { inflateRawSync } from "node:zlib";

/**
 * קריאת טבלה מקובץ שהמשתמש העלה — CSV או XLSX — בלי תלות חיצונית.
 *
 * למה בלי ספרייה: החבילה `xlsx` ב-npm נטושה מאז 2022 (SheetJS עברו למאגר
 * משלהם) ונושאת CVEים פתוחים, ולא רציתי להכניס אותה בשביל ייבוא רשימת לידים.
 * .xlsx הוא קובץ ZIP עם XML בפנים, ול-Node יש inflateRaw מובנה — אז הקורא
 * כאן מפרק את ה-ZIP ואת ה-XML ידנית.
 *
 * מה *לא* נתמך בכוונה: .xls ישן (פורמט בינארי אחר לגמרי), קבצים מוצפנים,
 * ZIP64 (קובץ עם יותר מ-65,535 רשומות פנימיות — לא קורה בגיליון אנשי קשר),
 * ועיצובי תאריך. אנחנו קוראים רק טקסט ומספרים; כל השאר מוחזר כמחרוזת.
 */

export type SheetRows = string[][];

// ── פענוח טקסט ─────────────────────────────────────────────────────────
// אקסל מייצא "CSV UTF-8" עם BOM, ולפעמים UTF-16LE ("Unicode Text"). בלי
// זיהוי ה-BOM עברית הופכת לג'יבריש, אז בודקים אותו לפני הפענוח.
function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  const text = new TextDecoder("utf-8").decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ── CSV ────────────────────────────────────────────────────────────────
/**
 * מפריד עמודות: פסיק, נקודה-פסיק או טאב. אקסל בהגדרות אזור ישראליות מייצא
 * לא פעם עם נקודה-פסיק, אז בחירה קשיחה בפסיק הייתה מחזירה עמודה אחת ענקית.
 * הזיהוי סופר מופעים *מחוץ* למרכאות בשורה הראשונה בלבד — שם יושבות הכותרות.
 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const char of firstLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ",";
}

/** RFC 4180: מרכאות כפולות עוטפות שדה, ו-"" בתוך שדה הוא מרכאה ספרותית. */
export function parseCsv(text: string): SheetRows {
  const delimiter = detectDelimiter(text);
  const rows: SheetRows = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      // \r\n נבלע כיחידה אחת; \r בודד (מק ישן) נחשב סוף שורה בפני עצמו
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // שורות ריקות *באמצע* נשמרות בכוונה: מספר השורה שמדווח למשתמש חייב להתאים
  // למה שהוא רואה באקסל, ודילוג עליהן כאן היה מזיז את כל המספרים אחריהן.
  return dropTrailingBlankRows(rows);
}

export function isBlankRow(row: string[]): boolean {
  return !row.some((cell) => cell.trim() !== "");
}

function dropTrailingBlankRows(rows: SheetRows): SheetRows {
  let end = rows.length;
  while (end > 0 && isBlankRow(rows[end - 1])) end -= 1;
  return rows.slice(0, end);
}

// ── ZIP ────────────────────────────────────────────────────────────────
function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  // ה-EOCD יושב בסוף הקובץ, אחרי הערה באורך משתנה — לכן סורקים אחורה.
  const maxCommentLength = 0xffff;
  const scanFrom = Math.max(0, buffer.length - maxCommentLength - 22);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= scanFrom; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("הקובץ אינו קובץ xlsx תקין (לא נמצא מבנה ZIP)");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || offset === 0xffffffff) {
    throw new Error("קובץ ZIP64 אינו נתמך — שמרו את הגיליון מחדש כ-CSV");
  }

  const entries = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(offset + 10);
    // תמיד מהאינדקס המרכזי ולא מהכותרת המקומית: כשדגל bit 3 דלוק (data
    // descriptor) הגדלים בכותרת המקומית הם אפסים.
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) entries.set(name, Buffer.from(data));
      else if (method === 8) entries.set(name, inflateRawSync(data));
      // כל שיטת דחיסה אחרת (bzip2/lzma) פשוט נדלגת — אקסל לא מייצר אותן
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ── XML ────────────────────────────────────────────────────────────────
function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return entity[1] === "x" || entity[1] === "X"
          ? String.fromCodePoint(parseInt(entity.slice(2), 16))
          : String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
  });
}

/** כל ה-<t> שבתוך אלמנט אחד, משורשרים — מחרוזת מעוצבת מפוצלת ל-<r><t> נפרדים. */
function textOf(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) {
    out += decodeXmlEntities(match[1] ?? "");
  }
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) =>
    textOf(m[1] ?? "")
  );
}

/** "BC12" → 54. אינדקס עמודה מבוסס-אפס מתוך ההפניה של התא. */
function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseSheet(xml: string, sharedStrings: string[]): SheetRows {
  const rows: SheetRows = [];

  for (const rowMatch of xml.matchAll(/<row(?:\s([^>]*))?>([\s\S]*?)<\/row>|<row\s([^>]*)\/>/g)) {
    const rowAttrs = rowMatch[1] ?? rowMatch[3] ?? "";
    const rowXml = rowMatch[2] ?? "";
    const cells: string[] = [];

    for (const cellMatch of rowXml.matchAll(
      /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    )) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";

      let value: string;
      if (type === "s") {
        const index = Number(body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "");
        value = sharedStrings[index] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        // n / str (תוצאת נוסחה) / b / e — כולם מגיעים כטקסט של <v>
        value = decodeXmlEntities(body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "");
      }

      // תאים ריקים לא נכתבים ל-XML בכלל, אז ממקמים לפי ההפניה ולא לפי הסדר
      const index = ref ? columnIndex(ref) : cells.length;
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }

    // אקסל לא כותב שורות ריקות ל-XML בכלל, אז מיקום לפי סדר ההופעה היה מזיז
    // את מספרי השורות. התכונה r היא מספר השורה האמיתי בגיליון.
    const rowNumber = Number(rowAttrs.match(/\br="(\d+)"/)?.[1] ?? NaN);
    const index = Number.isFinite(rowNumber) && rowNumber > 0 ? rowNumber - 1 : rows.length;
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }

  return dropTrailingBlankRows(rows);
}

function firstSheetPath(entries: Map<string, Buffer>): string {
  // הגיליון הראשון בסדר הלשוניות אינו בהכרח sheet1.xml — מתרגמים דרך
  // workbook.xml → r:id → ‎_rels/workbook.xml.rels‎, ורק כנפילה אחורה sheet1.
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");

  if (workbook && rels) {
    const relId = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    if (relId) {
      const target = rels.match(
        new RegExp(`<Relationship\\b[^>]*\\bId="${relId}"[^>]*\\bTarget="([^"]+)"`)
      )?.[1];
      if (target) {
        const path = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//, "")}`;
        if (entries.has(path)) return path;
      }
    }
  }

  const fallback = [...entries.keys()]
    .filter((k) => k.startsWith("xl/worksheets/") && k.endsWith(".xml"))
    .sort()[0];
  if (!fallback) throw new Error("לא נמצא גיליון בתוך הקובץ");
  return fallback;
}

export function parseXlsx(buffer: Buffer): SheetRows {
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8"));
  const sheetXml = entries.get(firstSheetPath(entries))?.toString("utf8");
  if (!sheetXml) throw new Error("לא נמצא גיליון בתוך הקובץ");
  return parseSheet(sheetXml, sharedStrings);
}

// ── נקודת כניסה ────────────────────────────────────────────────────────
export function parseSpreadsheet(fileName: string, buffer: Buffer): SheetRows {
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const looksXlsx = /\.xlsx$/i.test(fileName);

  if (isZip || looksXlsx) {
    if (!isZip) {
      throw new Error("הקובץ מסתיים ב-xlsx אבל אינו קובץ אקסל תקין");
    }
    return parseXlsx(buffer);
  }

  if (/\.xls$/i.test(fileName)) {
    throw new Error("פורמט .xls הישן אינו נתמך — שמרו מחדש כ-.xlsx או כ-CSV");
  }

  return parseCsv(decodeText(buffer));
}
