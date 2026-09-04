/**
 * מד חלון 24 השעות.
 *
 * זה הכלל היחיד שקובע מה מותר לשלוח למי: כל עוד הלקוח כתב ב-24 השעות
 * האחרונות מותר טקסט חופשי וזה חינם; אחרי זה מותרת רק תבנית שאושרה מראש
 * ב-Meta, והיא עולה כסף.
 *
 * עד עכשיו המצב הזה הופיע כטקסט ("חלון פתוח · 14 שע׳") בכל מסך אחרת. פס
 * קטן נסרק מהר יותר לאורך רשימה של עשרים שורות, ומראה גם *כמה* נשאר ולא רק
 * אם נשאר. שלושת המצבים נבדלים בצבע ובאורך גם יחד, כדי שהם ייקראו גם בלי
 * הבחנה בין גוונים.
 *
 * הלוגיקה עצמה לא כאן: isWithin24HourWindow ו-windowRemainingMs
 * (src/lib/whatsapp-cloud.ts) הן מקור האמת, וזו עטיפה חזותית בלבד.
 */

const WINDOW_HOURS = 24;

/** מתחת לזה נשאר מעט מדי זמן כדי להסתמך עליו — ראוי להתייחסות עכשיו. */
const LOW_HOURS = 3;

export function WindowMeter({
  openWindow,
  hoursLeft,
  className = "",
}: {
  openWindow: boolean;
  /** שעות שלמות שנותרו בחלון. נקרא רק כשהחלון פתוח. */
  hoursLeft: number;
  className?: string;
}) {
  const low = openWindow && hoursLeft <= LOW_HOURS;

  const tone = !openWindow
    ? { text: "var(--subtle)", fill: "var(--border-strong)", bg: "var(--surface-sunken)" }
    : low
      ? { text: "var(--warn)", fill: "var(--warn)", bg: "var(--warn-soft)" }
      : { text: "var(--ok)", fill: "var(--ok)", bg: "var(--ok-soft)" };

  const pct = openWindow ? Math.max(4, Math.min(100, (hoursLeft / WINDOW_HOURS) * 100)) : 0;

  const label = !openWindow ? "חלון סגור" : `${hoursLeft} שע׳`;
  const title = !openWindow
    ? "מחוץ לחלון 24 השעות — מותרת רק תבנית שאושרה ב-Meta, והיא מחויבת"
    : `בתוך חלון 24 השעות — נותרו ${hoursLeft} שעות לטקסט חופשי, ללא עלות`;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${className}`}
      style={{ color: tone.text, backgroundColor: tone.bg }}
    >
      <span
        aria-hidden
        className="h-1 w-6 shrink-0 overflow-hidden rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${tone.fill} 22%, transparent)` }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: tone.fill }}
        />
      </span>
      {label}
    </span>
  );
}
