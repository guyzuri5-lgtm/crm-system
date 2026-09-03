/**
 * תוצאה של Server Action, במקום זריקה.
 *
 * הרקע: ב-Next בפרודקשן טקסט של `throw new Error("הסבר בעברית")` בתוך Server
 * Action נמחק ומוחלף בשגיאה גנרית של React (#441), וזה מה ש-error.tsx מציג.
 * כלומר כל ההודעות המוקפדות בקוד — "לסטטוס הזה משויכים 80 אנשי קשר", "התמונה
 * גדולה מדי" — עבדו בפיתוח והיו בלתי נראות אצל המשתמש.
 *
 * הקובץ הזה חף מכוונה מ-"server-only": הטיפוס נצרך גם ברכיב הלקוח שמציג את
 * השגיאה, ו-toResult עצמו הוא try/catch בלי שום תלות בשרת.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * redirect() ו-notFound() של Next עובדים על ידי זריקה של שגיאה מיוחדת. אסור
 * לבלוע אותן — פעולה שקוראת ל-redirect אחרי הצלחה הייתה מדווחת "נכשל" ולא
 * מנווטת לשום מקום. הזיהוי הוא לפי digest, כי המחלקה עצמה אינה ציבורית.
 */
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

/**
 * עוטף גוף של פעולה קיימת בלי לגעת בו: מה שהיה `throw new Error("...")` חוזר
 * עכשיו כערך, עם אותו נוסח בדיוק.
 *
 * העטיפה נבחרה על פני שכתוב של 61 נקודות זריקה בשלושה קבצים — הנוסח העברי
 * בהן הוא הנכס, ושכתוב ידני שלהן היה מזמין טעויות העתקה בדיוק במקום שבו
 * ההודעה היא כל העניין.
 */
export async function toResult(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
