import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * כרטיס מדד: מספר גדול אחד, ומתחתיו ההקשר שמסביר אותו.
 *
 * לכל כרטיס יש בדיוק אלמנט חזותי אחד מתחת למספר — גרף מגמה או פס התקדמות,
 * לעולם לא שניהם. ארבעה כרטיסים עומדים כאן זה לצד זה, וכשלכל אחד יש שני
 * דברים לספר השורה כולה נקראת כרעש במקום כסיכום.
 */

export type MetricTileProps = {
  href: string;
  label: string;
  value: string;
  /** זנב קטן אחרי המספר, למשל "‎/ 30" בכרטיס האירוע. */
  suffix?: string;
  context: ReactNode;
  icon: ReactNode;
  /** גוון הכרטיס — אסימון מלא, למשל "var(--nav-pink)". */
  color: string;
  /** אותו גוון ברקע רך, לריבוע האייקון. */
  soft: string;
  /** ערך לכל יום, מהישן לחדש. פחות משתי נקודות — לא מצויר גרף. */
  trend?: number[];
  bar?: { value: number; max: number };
};

const SPARK_W = 120;
const SPARK_H = 26;

/**
 * נתיב SVG מרשימת ערכים. שוליים של 3 למעלה ולמטה כדי שהנקודה שבקצה לא
 * תיחתך בגבול ה-viewBox, ושורת אפסים לא תשב בדיוק על הקו התחתון.
 */
function sparkPath(points: number[]): string {
  const peak = Math.max(...points, 1);
  const step = SPARK_W / (points.length - 1);
  return points
    .map((value, i) => {
      const x = i * step;
      const y = SPARK_H - 3 - (value / peak) * (SPARK_H - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function MetricTile({
  href,
  label,
  value,
  suffix,
  context,
  icon,
  color,
  soft,
  trend,
  bar,
}: MetricTileProps) {
  const spark = trend && trend.length > 1 ? sparkPath(trend) : null;
  const last = trend?.[trend.length - 1] ?? 0;
  const peak = Math.max(...(trend ?? [1]), 1);

  return (
    <Link
      href={href}
      className="metric"
      style={{ "--metric-color": color } as CSSProperties}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="glyph size-6"
          style={{ "--glyph-color": color, "--glyph-bg": soft } as CSSProperties}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[11.5px] font-semibold text-[var(--muted)]">{label}</span>
      </div>

      {/*
        break-words ולא truncate: הכרטיס הרביעי מציג שגיאת ערוץ מלאה כשמשהו
        נשבר, ושגיאה חתוכה באמצע לא שווה כלום.
      */}
      <p className="metric-value break-words">
        {value}
        {suffix && <small className="text-base font-normal text-[var(--subtle)]">{suffix}</small>}
      </p>

      {spark && (
        <svg
          className="mt-2 h-[26px] w-full"
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* שטח דהוי מתחת לקו — נותן לגרף משקל בלי להוסיף עוד קו. */}
          <path
            d={`${spark} L${SPARK_W} ${SPARK_H} L0 ${SPARK_H} Z`}
            fill={color}
            opacity={0.1}
          />
          {/*
            non-scaling-stroke: ה-viewBox נמתח לרוחב הכרטיס ולא לגובהו, ובלי
            זה הקו היה נראה דק במאונך ועבה במאוזן.
          */}
          <path
            d={spark}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={SPARK_W}
            cy={SPARK_H - 3 - (last / peak) * (SPARK_H - 6)}
            r={2.6}
            fill={color}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {bar && bar.max > 0 && (
        <div className="bar mt-2.5" style={{ "--bar-color": color } as CSSProperties}>
          {/* חסם עליון: אירוע שנמכר מעבר לקיבולת לא אמור לגלוש מהפס החוצה. */}
          <i style={{ width: `${Math.min(100, Math.round((bar.value / bar.max) * 100))}%` }} />
        </div>
      )}

      <p className="mt-2 text-[11.5px] text-[var(--muted)]">{context}</p>
    </Link>
  );
}
