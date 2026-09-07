import type { ReactNode } from "react";

/**
 * המסגרת של הטופס המוטמע — הטוקנים של *דף הנחיתה*, ולא של המערכת.
 *
 * ── הבעיה שהיא פותרת ──
 * ההטמעה היא iframe, ו-iframe הוא מסמך נפרד: הוא לא יורש שום דבר מהעיצוב של
 * הדף המארח, והדפדפן גם חוסם ממנו לקרוא אותו. כלומר הטופס אינו יכול להתאים
 * את עצמו לאתר שהוא יושב בו — צריך *לומר* לו. עד כאן הוא קיבל את הטוקנים של
 * המערכת — ורדיגריס טורקיז, Plex Sans, פינות של 8 פיקסלים — והתוצאה על דף
 * נחיתה בירוק יער וזהב הייתה טופס שנראה כאילו הודבק מאתר אחר. הוא לא היה
 * מכוער; הוא פשוט דיבר שפה אחרת.
 *
 * ── שני מתגים, ולמה דווקא בכתובת ──
 * ‎mode‎ ו-‎accent‎ מגיעים כפרמטרים ב-URL של ההטמעה ולא כעמודות במסד. אתר חדש
 * הוא לא ישות שהמערכת מנהלת — אין לו רשומה, אין לו מחזור חיים, והוא לא נשאל
 * עליו שום שאלה חוץ מ"איך להיראות אצלך". כתובת ההטמעה היא בדיוק המקום שבו
 * התשובה הזו נולדת, ולכן פרויקט הבא = בוחרים צבע, מעתיקים, מדביקים.
 *
 * ── מה שהטוקנים מכסים בדרך אגב ──
 * הגדרה מחדש של *כל* הטוקנים שהטופס נוגע בהם מנטרלת גם את המצב הכהה: הסקריפט
 * ב-layout.tsx קורא את העדפת המערכת של הגולש, ובתוך iframe אין לו localStorage
 * לקרוא ממנו — כלומר גולש שהמכשיר שלו במצב כהה קיבל טופס שחור על דף נחיתה
 * קרם. ראו גם את ההערה על ‎color-scheme‎ בתוך ה-CSS.
 *
 * ── סדר השכבות ──
 * ‎.input‎ ו-‎.btn-primary‎ מוגדרים ב-@layer components, והבלוק כאן אינו בשום
 * שכבה — CSS נותן לחסר-שכבה לגבור, ולכן אין צורך ב-!important על התוספות.
 *
 * ── מאיפה ברירות המחדל ──
 * נדגמו מ-spiritualguy.co.il ב-6.9.26 (getComputedStyle על העמוד החי): הכפתור
 * ‎#23392D‎ בפינה עגולה מלאה, הכותרות ‎#1B3A2C‎, הרקעים קרם ‎#FBF8F1‎ ובז'
 * ‎#F1E9D8‎, והגופן Rubik — שכבר נטען במערכת ולכן לא נוסף כאן גופן חיצוני.
 */

/** הכפתור, כשההטמעה לא ביקשה צבע משלה. */
const DEFAULT_ACCENT = "#23392d";

export interface EmbedStyle {
  /** בלי כרטיס ובלי ריפוד — הטופס נשפך לתוך בלוק קיים בדף המארח. */
  bare: boolean;
  accent: string;
}

// ── צבע ────────────────────────────────────────────────────────────────────

/**
 * צבע מהכתובת עובר דרך כאן ורק אחר כך נכנס ל-CSS.
 *
 * הביטוי אינו נוחות אלא גבול: מחרוזת שמגיעה מבחוץ ומודבקת לגיליון סגנונות
 * היא הזרקה, וששת התווים ההקסדצימליים הם כל מה שיוצא מכאן.
 */
function readHex(raw: string | undefined, fallback: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec((raw ?? "").trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** ערבוב לכיוון שחור (0) או לבן (255). amount הוא 0–1. */
function mix(hex: string, target: number, amount: number): string {
  return (
    "#" +
    channels(hex)
      .map((v) => Math.round(v + (target - v) * amount).toString(16).padStart(2, "0"))
      .join("")
  );
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * הדיו שעל הכפתור, לפי הצבע שנבחר לו.
 *
 * הסף הוא 3 ולא 4.5 כי הכתובת על הכפתור היא 19 פיקסלים במשקל 700 — מעל
 * ‎18.66px bold‎, כלומר "טקסט גדול" לפי WCAG. זה מה שמאפשר ללבן לשרוד על זהב
 * ‎#AD8A2C‎ (3.26), בדיוק כמו בכפתור של דף הנחיתה עצמו. צבע בהיר באמת — צהוב
 * חיוור, ורוד פודרה — נופל מתחת לסף, ואז הדיו מתהפך לכהה במקום להישבר בשקט.
 */
function inkOn(accent: string): string {
  return contrast("#ffffff", accent) >= 3 ? "#ffffff" : "#1c1a17";
}

// ── הגיליון ────────────────────────────────────────────────────────────────

function css({ bare, accent }: EmbedStyle): string {
  return `
/* ── מה שהטוקנים למטה לא יכולים לכסות ──
   ‎color-scheme‎ נקבע כסגנון inline על ‎<html>‎ בסקריפט של layout.tsx, ומצב
   כהה שם גורם לדפדפן לצבוע את *הקנבס* של המסמך — השטח שמאחורי הרקע השקוף —
   בשחור. זה מה שהפך את המסגרת למלבן שחור על דף נחיתה קרם אצל כל גולש
   שהמכשיר שלה במצב כהה. הצהרה עם ‎!important‎ בגיליון גוברת על סגנון inline
   רגיל, וזו הדרך היחידה לבטל אותו בלי לגעת בסקריפט שמשרת את שאר המערכת. */
:root{color-scheme:light!important;background:transparent!important}
body{background:transparent!important}

.embed-frame{
  color-scheme:light;
  font-family:var(--font-rubik),"Assistant","Heebo",system-ui,sans-serif;
  padding:${bare ? "0" : "4px"};

  --foreground:#1b3a2c;
  --muted:#57635b;
  --subtle:#6f7872;
  --surface:#ffffff;
  --border-strong:#e0d8c7;

  --primary:${accent};
  --primary-hover:${mix(accent, 0, 0.18)};
  --primary-soft:${mix(accent, 255, 0.88)};
  --on-primary:${inkOn(accent)};

  --danger:#a63232;
  --danger-soft:#f8eae7;
  --nav-amber:#8a6a12;
  --nav-amber-soft:#f6efd9;

  --shadow-1:0 1px 2px rgb(27 58 44 / 0.05);
}

.embed-frame .field-label{gap:7px;font-size:14px;font-weight:600}

/* 16 פיקסלים ולא 14: ספארי בנייד מקרב את המסך אוטומטית לכל שדה שהגופן בו
   קטן מ-16, והדף המארח קופץ ברגע שנוגעים בשדה הראשון. */
.embed-frame .input{
  padding:11px 14px;
  border-radius:12px;
  font-size:16px;
  background:#fdfbf6;
}

/* פינה עגולה מלאה ורוחב מלא — אותה צורה בדיוק של כפתור הרכישה בדף הנחיתה.
   19 פיקסלים במשקל 700 גם עומדים בסף "טקסט גדול", ראו inkOn. */
.embed-frame .btn-primary{
  width:100%;
  padding:15px 22px;
  border-radius:999px;
  font-size:19px;
  font-weight:700;
}
${
  bare
    ? ""
    : `
/* הכרטיס הלבן הוא הד לכרטיס המחיר שמעליו בדף הנחיתה: שדות לבנים שצפים
   ישירות על רצועה בז' נקראים כשאריות, ואותם שדות בתוך כרטיס נקראים כחלק
   מהעמוד. הגבול החם שומר עליו קריא גם על רצועה לבנה, שם הכרטיס עצמו נעלם.
   ב-mode=bare הוא נעדר לגמרי — שם הבלוק המארח כבר עושה את העבודה הזו. */
.embed-frame .embed-card{
  max-width:420px;
  margin-inline:auto;
  padding:26px 22px;
  border:1px solid #ece5d7;
  border-radius:22px;
  background:#ffffff;
  box-shadow:0 1px 2px rgb(27 58 44 / 0.05),0 18px 40px -28px rgb(27 58 44 / 0.3);
}`
}
`;
}

// ── ה-API של הדפים ─────────────────────────────────────────────────────────

/** קורא את שני המתגים מהכתובת. כל מה שאינו מוכר נופל לברירת המחדל. */
export function parseEmbedStyle(params: Record<string, string | string[] | undefined>): EmbedStyle {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    bare: first("mode") === "bare",
    accent: readHex(first("accent"), DEFAULT_ACCENT),
  };
}

/**
 * עוטף את הטופס המוטמע: הטוקנים, והכרטיס שמחזיק אותו.
 *
 * הכרטיס עוטף גם את מסך התודה שמחליף את הטופס אחרי ההרשמה — הוא מתכווץ
 * לגובה של שתי שורות, אבל נשאר אותו עצם על הדף במקום להיעלם ולהחליף את
 * עצמו בטקסט חופשי.
 */
export function EmbedFrame({ children, style }: { children: ReactNode; style: EmbedStyle }) {
  return (
    <>
      <style>{css(style)}</style>
      <div className="embed-frame">
        {style.bare ? children : <div className="embed-card">{children}</div>}
      </div>
    </>
  );
}
