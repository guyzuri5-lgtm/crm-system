// מסנכרן את תוכן השאלון מ-index.html אל src/lib/quiz-copy.generated.ts
//
// למה גנרטור ולא העתקה ידנית:
//   מייל התוצאות נבנה בשרת (ראו src/lib/quiz-email.ts). הוא חייב את הטקסטים,
//   אבל אסור שהדפדפן ישלח אותם — endpoint ציבורי שמקבל טקסט חופשי ושולח אותו
//   במייל לכתובת כלשהי הוא ממסר ספאם. לכן הטקסטים יושבים בשרת, וכדי שלא
//   ייווצר נתק בין שני העותקים הם נשאבים מ-index.html בפקודה אחת:
//
//     npm run sync:quiz-copy
//
//   index.html נשאר המקור היחיד לאמת. אחרי כל עריכת תוכן שם — הריצו את זה.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(here, "../src/lib/quiz-copy.generated.ts");

/**
 * איתור index.html — מקור האמת של תוכן השאלון.
 *
 * הוא יושב מחוץ לפרויקט, ליד שאר נכסי האתר, ולכן הנתיב אליו אינו יציב:
 * ב-25/08/2026 הפרויקט הועבר ל-Cloude code/CRM והנתיב הקודם (../../index.html)
 * הפסיק להצביע עליו. במקום נתיב יחיד שנשבר בשקט, מחפשים ברשימת מיקומים
 * מוכרים — והכשל, אם יגיע, אומר בדיוק איפה חיפשנו.
 *
 * לדריסה מפורשת:
 *   npm run sync:quiz-copy -- /path/to/index.html
 *   QUIZ_SOURCE_HTML=/path/to/index.html npm run sync:quiz-copy
 */
function resolveSource() {
  const override = process.argv[2] || process.env.QUIZ_SOURCE_HTML;
  const candidates = [
    ...(override ? [resolve(process.cwd(), override)] : []),
    resolve(here, "../../שאלון צ׳אקרות/index.html"),          // המיקום הנוכחי
    resolve(here, "../../index.html"),                        // הפרויקט לצד השאלון
    resolve(here, "../../../תיקיה ללא שם/index.html"),        // מיקום היסטורי
    resolve(here, "../index.html"),                           // בתוך הפרויקט
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  throw new Error(
    "לא נמצא index.html של השאלון. חיפשתי ב:\n" +
      candidates.map((c) => `  · ${c}`).join("\n") +
      "\n\nהריצו עם נתיב מפורש:  npm run sync:quiz-copy -- /path/to/index.html"
  );
}

const SOURCE = resolveSource();

/** חילוץ הטקסט של `const NAME = <literal>;` מתוך הקובץ, בעזרת ספירת סוגריים. */
function extractLiteral(src, name) {
  const start = src.indexOf(`\nconst ${name} = `);
  if (start === -1) throw new Error(`לא נמצא "const ${name}" ב-index.html`);

  let i = src.indexOf("=", start) + 1;
  while (/\s/.test(src[i])) i++;

  const open = src[i];
  if (open !== "{" && open !== "[" && open !== '"') {
    // מחרוזת פשוטה בגרשיים בודדים או כפולים — נקרא עד סוף השורה
    const eol = src.indexOf("\n", i);
    return src.slice(i, eol).replace(/;\s*$/, "");
  }

  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = null;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (inString) {
      if (ch === "\\") j++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  throw new Error(`הליטרל של ${name} לא נסגר`);
}

const html = readFileSync(SOURCE, "utf8");

/** הופך את טקסט הליטרל לערך אמיתי. הקלט הוא קובץ מקומי שלנו, לא קלט משתמש. */
function evaluate(name) {
  const literal = extractLiteral(html, name);
  return new Function(`return (${literal});`)();
}

const DIAGNOSIS    = evaluate("DIAGNOSIS");
const BLOCK_SUMMARY = evaluate("BLOCK_SUMMARY");
const BRIDGE       = evaluate("BRIDGE");
const CHAKRAS      = evaluate("CHAKRAS");

const PERSISTENCE = (() => {
  const m = html.match(/\nconst PERSISTENCE = ("(?:[^"\\]|\\.)*")\s*;/);
  if (!m) throw new Error('לא נמצא "const PERSISTENCE" ב-index.html');
  return JSON.parse(m[1]);
})();

// מהצ'אקרות נשמר רק מה שהמייל צריך — שם, סנסקריט, צבע ונושאים.
const chakraMeta = Object.fromEntries(
  Object.entries(CHAKRAS).map(([key, c]) => [
    key,
    { id: c.id, name: c.name, sanskrit: c.sanskrit, color: c.color, ink: c.ink, themes: c.themes },
  ])
);

const banner = `// ⚠ קובץ מיוצר אוטומטית — אל תערכו אותו ידנית.
//
// המקור: index.html של השאלון (אובייקטי DIAGNOSIS, BLOCK_SUMMARY, BRIDGE, PERSISTENCE, CHAKRAS).
// לרענון אחרי שינוי תוכן בשאלון:  npm run sync:quiz-copy
//
// נוצר: ${new Date().toISOString().slice(0, 10)}
`;

const body = `${banner}
import type { ChakraKey } from "./quiz";

export type FlowKey = "blocked" | "partial" | "balanced" | "open";

export interface DiagnosisEntry {
  meaning: string;
  signs: string[];
  step: string;
}

export const DIAGNOSIS: Record<ChakraKey, Record<FlowKey, DiagnosisEntry>> =
${JSON.stringify(DIAGNOSIS, null, 2)};

export const BLOCK_SUMMARY: Record<ChakraKey, { symptoms: string; consequence: string }> =
${JSON.stringify(BLOCK_SUMMARY, null, 2)};

export const BRIDGE: Record<ChakraKey, string> =
${JSON.stringify(BRIDGE, null, 2)};

export const PERSISTENCE = ${JSON.stringify(PERSISTENCE)};

export const CHAKRA_META: Record<
  ChakraKey,
  { id: number; name: string; sanskrit: string; color: string; ink: string; themes: string[] }
> = ${JSON.stringify(chakraMeta, null, 2)};
`;

writeFileSync(TARGET, body, "utf8");

const centers = Object.keys(DIAGNOSIS).length;
const entries = Object.values(DIAGNOSIS).reduce((n, v) => n + Object.keys(v).length, 0);
console.log(`✓ ${TARGET.replace(process.cwd() + "/", "")}`);
console.log(`  ${centers} מרכזים · ${entries} בלוקי אבחון · ${Object.keys(BRIDGE).length} משפטי גשר`);
