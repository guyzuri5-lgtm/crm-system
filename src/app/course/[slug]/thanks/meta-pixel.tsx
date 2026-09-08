import Script from "next/script";

/**
 * פיקסל מטא של קורס המדיטציה — אירוע Purchase בעמוד התודה.
 *
 * למה קומפוננטה נפרדת ולא ה-layout: עמוד התודה חולק את ה-layout השורשי עם
 * כל האפליקציה, וכל סקריפט שיושב שם רץ גם במסכי הניהול וגם בעמודי ההרשמה.
 * כאן הפיקסל נטען מתוך העמוד עצמו, ורק כשה-slug הוא meditation.
 *
 * הסכום קבוע בקוד כי לטבלת courses אין עמודת מחיר — התשלום נגבה בגרואו ולא
 * במערכת, ולכן אין מאיפה לגזור אותו. שינוי מחיר מחייב שינוי כאן.
 */

/** הקורס היחיד שהפיקסל שייך לו. עמוד תודה של כל slug אחר לא יטען אותו. */
export const META_PIXEL_COURSE_SLUG = "meditation";

/** הפיקסל של גיא ב-Meta Events Manager. */
const PIXEL_ID = "654226490770744";

/** מחיר הקורס בגרואו, בשקלים. */
const PURCHASE_VALUE = "88.00";

/**
 * strategy="afterInteractive": הסקריפט נטען מיד אחרי ההידרציה, בכל טעינת
 * עמוד מלאה — וכניסה לעמוד הזה היא תמיד טעינה מלאה, כי גרואו מפנה אליו
 * מדומיין אחר. ה-id חובה: next/script מחזיק Set של מזהים ברמת המודול, ולכן
 * גם ה-mount הכפול של Strict Mode וגם כל re-render לא מריצים את הגוף פעמיים.
 *
 * ── למה Purchase מוגן ו-PageView לא ──────────────────────────────────────
 *
 * "פעם אחת בכל טעינה" לא מספיק לאירוע רכישה: רענון של עמוד התודה, או חזרה
 * אליו מההיסטוריה, הם טעינה חדשה — ולקוח אחד היה נספר כשתי מכירות. בקמפיין
 * שמתמטב על רכישות זה מזהם גם את הספירה וגם את ה-ROAS.
 *
 * הפתרון המקובל הוא eventID של העסקה, אבל לעמוד הזה אין מזהה עסקה: גרואו
 * מפנה אליו בלי פרמטרים ובלי session, וזו בדיוק הסיבה שהעמוד נגזר מה-slug
 * בלבד. לכן ההגנה היא סימון בדפדפן, ו-eventID נלווה כקו הגנה שני — הוא
 * מכווץ כפילות אצל מטא אם שתי לשוניות נטענות יחד לפני שהסימון נכתב, והוא
 * גם מה שיאפשר חיבור ל-Conversions API בעתיד בלי לספור פעמיים.
 *
 * שלוש התנהגויות מכוונות שכדאי להכיר:
 *
 *   · PageView נשאר בכל טעינה. הוא אירוע תנועה, וכפילות בו צפויה ולא מזיקה.
 *   · חלון פרטי או דפדפן שחוסם אחסון — נכשל *פתוח*: הרכישה מדווחת בלי הגנה.
 *     עדיף לספור פעמיים מאשר לאבד מכירה אמיתית.
 *   · רכישה שנייה אמיתית מאותו דפדפן לא תדווח. זה קורס דיגיטלי חד-פעמי, אז
 *     המחיר הזה זניח מול הזיהום שרענון יוצר.
 */
export function MetaPixelPurchase() {
  return (
    <Script id="meta-pixel-purchase" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');
(function(){
  var key = 'meta-pixel-purchase:${META_PIXEL_COURSE_SLUG}';
  var reported = null;
  try { reported = window.localStorage.getItem(key); } catch (e) {}
  if (reported) return;
  var id = null;
  try { id = window.crypto.randomUUID(); } catch (e) {}
  if (!id) id = 'p' + Date.now() + Math.random().toString(16).slice(2);
  try { window.localStorage.setItem(key, id); } catch (e) {}
  fbq('track', 'Purchase', {value: ${PURCHASE_VALUE}, currency: 'ILS'}, {eventID: id});
})();`}
    </Script>
  );
}
