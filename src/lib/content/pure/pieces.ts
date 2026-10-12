/**
 * פיסות תוכן — הלוגיקה הטהורה (בלי מסד ובלי רשת), כדי שאפשר לבדוק אותה ב-node --test.
 *
 * העיקר: התאמה בין תמלול של סרטון מצולם לבין הטקסט שנכתב בפרומפטר. גיא לא
 * מקריא מילה במילה, ולכן ההשוואה היא על מילים ולא על משפטים: כמה ממילות התוכן
 * של הפיסה נאמרו בסרטון, ועוד צמדי מילים כדי להעדיף את הפיסה שהסדר שלה דומה.
 */

const NIQQUD = /[֑-ׇ]/g;
const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
// מילים שחוזרות בכל פיסה ולא מבדילות בין אחת לשנייה
const STOP = new Set([
  "את", "של", "על", "זה", "זו", "הוא", "היא", "הם", "הן", "אני", "אתם", "אתן", "אנחנו", "לא", "כן", "גם",
  "אבל", "או", "כי", "אם", "מה", "מי", "איך", "למה", "כל", "יש", "אין", "עם", "רק", "עוד", "כמו", "אז",
  "פשוט", "ממש", "בעצם", "תראו", "ידעתם", "שלכם", "לכם", "אתכם", "שלנו", "לנו", "אותו", "אותה", "הזה",
  "הזאת", "היה", "היו", "להיות", "שזה", "זאת", "כך", "ככה", "יותר", "הכי", "אחד", "אחת", "שני", "שתי",
]);
const PREFIX = /^(וה|וש|שה|מה|כש|לכש|ו|ה|ב|ל|מ|ש|כ)(?=.{3,})/;

export function normalizeHe(text: string): string {
  return String(text || "")
    .replace(NIQQUD, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** מילות תוכן, בלי אות שימוש בהתחלה ("והגוף" → "גוף") */
export function contentWords(text: string): string[] {
  return normalizeHe(text)
    .split(" ")
    .map((w) => w.replace(PREFIX, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

function bigrams(words: string[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + 1 < words.length; i++) s.add(`${words[i]} ${words[i + 1]}`);
  return s;
}

/**
 * ציון 0–1: כמה מהפיסה נאמר בסרטון.
 * 70% מילים (ריקול של מילות הפיסה), 30% צמדי מילים.
 */
export function matchScore(transcript: string, script: string): number {
  const t = contentWords(transcript);
  const s = contentWords(script);
  if (!t.length || !s.length) return 0;
  const tSet = new Set(t);
  const sSet = new Set(s);
  let hit = 0;
  for (const w of sSet) if (tSet.has(w)) hit++;
  const words = hit / sSet.size;
  const tb = bigrams(t);
  const sb = bigrams(s);
  let bhit = 0;
  for (const b of sb) if (tb.has(b)) bhit++;
  const pairs = sb.size ? bhit / sb.size : 0;
  return Math.round((0.7 * words + 0.3 * pairs) * 1000) / 1000;
}

/** שני תסריטים שהם בעצם אותו מסמך (עותק בדרייב): דמיון גבוה לשני הכיוונים */
export const DUPLICATE_MIN = 0.85;
export function isDuplicateScript(a: string, b: string): boolean {
  if (contentWords(a).length < 8 || contentWords(b).length < 8) return false;
  return Math.min(matchScore(a, b), matchScore(b, a)) >= DUPLICATE_MIN;
}

export const MATCH_MIN = 0.3;
export const MATCH_MARGIN = 0.08;

export interface Candidate { pieceNo: number; title: string; script: string | null }
export interface Ranked { pieceNo: number; title: string; score: number }

/** מדרג את הפיסות מול תמלול. confident רק כשהראשונה ברורה וגם מספיק גבוהה. */
export function rankCandidates(transcript: string, candidates: Candidate[]) {
  const ranked: Ranked[] = candidates
    .filter((c) => c.script && c.script.trim())
    .map((c) => ({ pieceNo: c.pieceNo, title: c.title, score: matchScore(transcript, c.script as string) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const second = ranked[1]?.score ?? 0;
  const confident = Boolean(best && best.score >= MATCH_MIN && best.score - second >= MATCH_MARGIN);
  return { best, confident, ranked: ranked.slice(0, 5) };
}

/** הטקסט שמצולם: מה שאחרי הכותרת "גרסה בשפה שלי". אם אין כותרת כזו — כל המסמך. */
export function extractScript(docText: string): string {
  const text = String(docText || "").replace(/\r/g, "");
  const m = /גרסה בשפה שלי[^\n]*\n/.exec(text);
  const body = m ? text.slice(m.index + m[0].length) : text;
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

/** "רפרנס | Spirit Science | הגוף שלכם הוא קשת" → "הגוף שלכם הוא קשת"; גם בלי מספר בהתחלה */
export function titleFromDocName(name: string): string {
  const parts = String(name || "").split("|").map((p) => p.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : String(name || "");
  return last.replace(/^\d{1,5}\s*-\s*/, "").trim() || "ללא כותרת";
}

/** מספר שכבר מופיע בתחילת שם ("13- כותרת"), או מתוך sourceKey של הגאנט ("dir:13- כותרת") */
export function parsePieceNo(s: string): number | null {
  const m = /(?:^|[:/\\])\s*(\d{1,5})\s*-\s/.exec(String(s || ""));
  return m ? Number(m[1]) : null;
}

/** שם לתיקייה ולמסמך: "13- כותרת", בלי תווים שאסורים בשמות קבצים */
export function pieceName(pieceNo: number, title: string): string {
  const clean = String(title || "").replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return `${pieceNo}- ${clean}`;
}

/** קישור לרילס בצורה אחידה, כדי להשוות permalink מ-Zernio מול permalink מאינסטגרם */
export function normPermalink(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p)\/([A-Za-z0-9_-]+)/.exec(String(url));
  return m ? m[1] : null;
}
