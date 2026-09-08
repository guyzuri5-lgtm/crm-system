import Script from "next/script";

/**
 * פיקסל מטא של קורס המדיטציה — אירוע Purchase בעמוד התודה.
 *
 * למה קומפוננטה נפרדת ולא ה-layout: עמוד התודה חולק את ה-layout השורשי עם
 * כל האפליקציה, וכל סקריפט שיושב שם רץ גם במסכי הניהול וגם בעמודי ההרשמה.
 * כאן הפיקסל נטען מתוך העמוד עצמו, ורק כשה-slug הוא meditation.
 *
 * הסכום קבוע בקוד כי לטבלת courses אין עמודת מחיר — התשלום נגבה בגרואו ולא
 * במערכת, ולכן אין מאיפה לגזור אותו.
 */

/** הקורס היחיד שהפיקסל שייך לו. עמוד תודה של כל slug אחר לא יטען אותו. */
export const META_PIXEL_COURSE_SLUG = "meditation";

/**
 * strategy="afterInteractive": הסקריפט נטען מיד אחרי ההידרציה, בכל טעינת
 * עמוד מלאה — וכניסה לעמוד הזה היא תמיד טעינה מלאה, כי גרואו מפנה אליו
 * מדומיין אחר.
 *
 * ה-id הוא מה שמונע ירייה כפולה, ולכן הוא חובה: next/script מחזיק Set של
 * מזהים ברמת המודול ומדלג על סקריפט שכבר בו. כך גם ה-mount הכפול של Strict
 * Mode בפיתוח וגם כל re-render לא מריצים את הגוף פעם שנייה, ו-Purchase נורה
 * פעם אחת בדיוק.
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
fbq('init', '654226490770744');
fbq('track', 'PageView');
fbq('track', 'Purchase', {value: 88.00, currency: 'ILS'});`}
    </Script>
  );
}
