/**
 * שלדי טעינה — מה שהמסך מציג בזמן שהנתונים בדרך.
 *
 * ── למה זה קיים ──
 * כל עמוד במערכת נבנה בשרת ושואב מהמסד. עד עכשיו לא היה שום דבר להציג עד
 * שהשאילתה האחרונה חזרה, ולכן לחיצה על פריט בסרגל לא עשתה *כלום* לשנייה או
 * שתיים — המסך הישן נשאר על מקומו, ורק אחר כך התחלף. זה הדבר שנקרא "המערכת
 * איטית", גם כשהיא לא: היא פשוט שתקה.
 *
 * שלד פותר את זה בשתי דרכים בבת אחת. הוא נותן משוב מיידי ללחיצה, והוא גם מה
 * ש-Next שולף מראש (prefetch) עבור עמוד דינמי — בלי loading.tsx הוא לא שולף
 * דבר, ועם loading.tsx הוא מוריד את השלד בזמן שהעכבר עוד מרחף מעל הקישור.
 *
 * ── הכלל היחיד שחשוב ──
 * שלד חייב לתפוס את אותו מקום כמו התוכן שיחליף אותו. שלד בגובה שגוי גרוע
 * מספינר: הוא מצייר פריסה, ואז הפריסה קופצת. לכן הגבהים כאן אינם שרירותיים
 * אלא לקוחים מהרכיבים האמיתיים.
 */

/**
 * קו טקסט. הרוחב באחוזים כדי שיתאים לכל מיכל.
 *
 * span ולא div: קו שלד מחליף טקסט, ולכן הוא צריך להיות מותר גם בתוך <p>
 * ו-<span>. div שם הוא HTML לא תקין, והדפדפן סוגר את הפסקה מוקדם ושובר
 * את הפריסה בשקט.
 */
export function SkelLine({
  w = "100%",
  h = 12,
  className = "",
}: {
  w?: string;
  h?: number;
  className?: string;
}) {
  return <span className={`skeleton block ${className}`} style={{ width: w, height: h }} />;
}

/** ריבוע — אווטאר, אייקון, תמונה ממוזערת. */
export function SkelBox({
  size = 40,
  radius = 12,
  className = "",
}: {
  size?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      className={`skeleton block ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
    />
  );
}

/** כרטיס מדד בדף הבית — ריבוע אייקון, מספר גדול, תווית. */
export function SkelMetric() {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <SkelBox size={28} radius={10} />
        <SkelLine w="70px" h={11} />
      </div>
      <SkelLine w="52px" h={26} />
      <SkelLine w="90px" h={11} />
    </div>
  );
}

/** רצועת כרטיסי מדד. */
export function SkelMetricRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <SkelMetric key={i} />
      ))}
    </div>
  );
}

/**
 * שורה ברשימה עם אווטאר — "מי שיצר קשר", תוצאות חיפוש, נרשמות.
 * הגובה (72 פיקסלים) הוא זה של ContactRow הסגורה.
 */
export function SkelListRow() {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-4 last:border-b-0">
      <SkelBox size={38} radius={13} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <SkelLine w="38%" h={13} />
        <SkelLine w="62%" h={11} />
      </div>
      <SkelLine w="64px" h={11} />
    </div>
  );
}

/** רשימה שלמה בתוך כרטיס. */
export function SkelList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card overflow-hidden p-0">
      {Array.from({ length: rows }, (_, i) => (
        <SkelListRow key={i} />
      ))}
    </div>
  );
}

/**
 * טבלה. מקבלת את מספר העמודות האמיתי כשהוא ידוע מראש (עמוד אנשי הקשר יודע
 * כמה שדות מוצגים רק אחרי שאילתה, ולכן שם זו הערכה) — הרוחב הכולל נכון בכל
 * מקרה, וזה מה שמונע את הקפיצה האופקית.
 */
export function SkelTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <div className="flex gap-4 px-4 py-2.5" style={{ backgroundColor: "var(--background)" }}>
        {Array.from({ length: cols }, (_, i) => (
          <SkelLine key={i} w={`${Math.round(100 / cols)}%`} h={10} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-t border-[var(--border)] px-4 py-3.5">
          {Array.from({ length: cols }, (_, c) => (
            <SkelLine key={c} w={`${Math.round(100 / cols)}%`} h={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** כרטיס עם כותרת וכמה שורות — לכל מקטע שאינו רשימה ואינו טבלה. */
export function SkelCard({ lines = 3, title = true }: { lines?: number; title?: boolean }) {
  return (
    <div className="card flex flex-col gap-3">
      {title && <SkelLine w="140px" h={14} />}
      {Array.from({ length: lines }, (_, i) => (
        <SkelLine key={i} w={i === lines - 1 ? "60%" : "100%"} h={12} />
      ))}
    </div>
  );
}

/** רשת כרטיסים — קורסים, אירועים, מסעות, תבניות. */
export function SkelCardGrid({ count = 6, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <SkelCard key={i} lines={lines} />
      ))}
    </div>
  );
}
