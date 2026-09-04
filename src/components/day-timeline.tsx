import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * ציר "היום": כל מה שקורה היום על קו זמן אחד, עם סימון היכן עומדת השעה
 * כרגע. פגישות והניוזלטר המתוזמן יושבים על אותו ציר בכוונה — שניהם דברים
 * שיוצאים היום, והפרדה שלהם לשתי רשימות מסתירה את הסדר שביניהם.
 *
 * קו "עכשיו" נקבע ברגע הרינדור בשרת ואינו זז מעצמו. הדף הוא force-dynamic
 * ולכן הוא נכון בכל טעינה — אבל לא מתקדם בין טעינה לטעינה.
 */

export type DayItem = {
  key: string;
  /** דקות מחצות בשעון ישראל. לפי זה נקבע מקומו של קו "עכשיו". */
  minutes: number;
  /** "09:00" — מעוצב באזור הזמן הנכון על ידי הקורא. */
  time: string;
  title: string;
  detail: string;
  /** אסימון מלא לנקודה על הציר, למשל "var(--nav-pink)". */
  color: string;
  href?: string;
};

type Row = { kind: "now" } | { kind: "item"; item: DayItem };

export function DayTimeline({
  items,
  nowMinutes,
  nowLabel,
}: {
  items: DayItem[];
  nowMinutes: number;
  nowLabel: string;
}) {
  if (!items.length) return null;

  const sorted = [...items].sort((a, b) => a.minutes - b.minutes);
  // קו "עכשיו" נכנס לפני הפריט הראשון שעוד לא הגיע. כשהכול כבר עבר הוא
  // נופל לסוף הציר, וכשהיום עוד לא התחיל — לראשו.
  const at = sorted.findIndex((item) => item.minutes > nowMinutes);
  const nowIndex = at === -1 ? sorted.length : at;

  const rows: Row[] = [
    ...sorted.slice(0, nowIndex).map((item): Row => ({ kind: "item", item })),
    { kind: "now" },
    ...sorted.slice(nowIndex).map((item): Row => ({ kind: "item", item })),
  ];

  /** first/last קוטעים את הקו האנכי בקצוות, כדי שלא יבלוט מעבר לנקודות. */
  const edgeOf = (i: number) => {
    const edges = [i === 0 ? "first" : "", i === rows.length - 1 ? "last" : ""].filter(Boolean);
    return edges.length ? edges.join(" ") : undefined;
  };

  return (
    <ol className="flex flex-col">
      {rows.map((row, i) =>
        row.kind === "now" ? (
          <li key="now" className="day-now" data-edge={edgeOf(i)}>
            <time className="data text-[10.5px] font-medium text-[var(--danger)]">{nowLabel}</time>
            <span className="day-rail">
              <i />
            </span>
            {/* ps ולא pe: התוכן יושב משמאל לפס, והצד ה"מתחיל" שלו הוא זה
                שפונה אל הפס — כלומר ימין. */}
            <span className="ps-3">
              <span className="day-now-line block" />
            </span>
          </li>
        ) : (
          <li
            key={row.item.key}
            className="day-row"
            data-edge={edgeOf(i)}
            style={{ "--dot-color": row.item.color } as CSSProperties}
          >
            <time className="data pt-px text-xs text-[var(--subtle)]" dateTime={row.item.time}>
              {row.item.time}
            </time>
            <span className="day-rail">
              <i />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 ps-3">
              {row.item.href ? (
                <Link href={row.item.href} className="text-[13px] font-medium hover:underline">
                  {row.item.title}
                </Link>
              ) : (
                <span className="text-[13px] font-medium">{row.item.title}</span>
              )}
              <span className="text-[11.5px] text-[var(--muted)]">{row.item.detail}</span>
            </span>
          </li>
        )
      )}
    </ol>
  );
}
