/**
 * גרסאות לאותה הודעת וואטסאפ — חישוב טהור, בלי מסד ובלי רשת.
 *
 * עשרות הודעות זהות מאותו מספר הן החתימה הכי ברורה של בוט, וזה בדיוק מה
 * שוואטסאפ מחפשת בערוץ לא רשמי. בתבנית אפשר לכתוב כמה נוסחים, מופרדים בשורה
 * שיש בה רק שלושה מקפים (---), ובכל שליחה נבחר אחד באקראי.
 *
 * וואטסאפ בלבד: במייל "---" הוא קו מפריד לגיטימי בתוך הטקסט.
 *
 * הקובץ לא מייבא כלום, כדי שאפשר יהיה לבדוק אותו ב-node --test ישירות.
 */

const SEPARATOR = /\n[ \t]*-{3,}[ \t]*\n/;

/** כל הגרסאות שבטקסט, אחרי ניקוי. טקסט בלי מפריד = גרסה אחת. */
export function splitVariants(body: string): string[] {
  const parts = body
    .replace(/\r\n/g, "\n")
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [body.trim()];
}

export function pickVariant(body: string, random: () => number = Math.random): string {
  const variants = splitVariants(body);
  return variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))];
}

/**
 * מילות הסרה. הודעה נכנסת שכולה אחת מהן מוציאה את איש הקשר מכל הוואטסאפ
 * האוטומטי. התאמה מלאה ולא "מכיל": "אל תסיר אותי" או "הסרתי את זה" הם לא בקשה.
 */
const OPT_OUT_WORDS = ["הסר", "הסרה", "להסיר", "הסירו", "הסר אותי", "תסיר", "תסיר אותי", "stop", "unsubscribe", "עצור"];

export function isOptOutMessage(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,׳"'\s]+$/g, "")
    .replace(/\s+/g, " ");
  return OPT_OUT_WORDS.includes(normalized);
}
