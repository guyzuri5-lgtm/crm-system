/**
 * תרשים הזרימה של המסע — תיבות וחיצים.
 *
 * SVG ולא ספריית קנבס: המסע הוא טור אחד של שלבים, וטור אחד לא מצדיק ספרייה
 * שמביאה איתה גרירה, פריסה אוטומטית וניהול מצב. כשיתווספו הסתעפויות אמיתיות
 * זו תהיה השאלה הנכונה לשאול מחדש.
 *
 * המידות מחושבות כאן ולא ב-CSS כי SVG צריך viewBox מספרי, והוא מה שמאפשר
 * לתרשים להתכווץ יפה במסך צר במקום להיחתך.
 */

interface FlowStep {
  position: number;
  waitDays: number;
  channel: "whatsapp" | "email";
  templateName: string;
  stopIfReplied: boolean;
}

const BOX_W = 190;
const BOX_H = 78;
const GAP = 58;
const PAD = 12;

export function JourneyFlow({
  entryLabel,
  steps,
}: {
  entryLabel: string;
  steps: FlowStep[];
}) {
  if (!steps.length) {
    return (
      <p className="text-sm text-[var(--subtle)]">
        אין שלבים להציג. הוסיפו שלב ראשון ותראו אותו כאן.
      </p>
    );
  }

  // תיבת הכניסה ואחריה שלב לכל צעד.
  const boxes = steps.length + 1;
  const width = boxes * BOX_W + (boxes - 1) * GAP + PAD * 2;
  const height = BOX_H + PAD * 2 + 34;

  const x = (i: number) => PAD + i * (BOX_W + GAP);
  const midY = PAD + BOX_H / 2;

  return (
    /*
      dir=ltr על המכל ולא על ה-svg: הזרימה היא משמאל לימין כמו בכל תרשים
      זרימה, גם בדף עברי, והפיכתה הייתה הופכת את החיצים לבלתי קריאים. על
      אלמנט svg עצמו React אינו מקבל dir.
    */
    <div className="overflow-x-auto" dir="ltr">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`תרשים המסע: ${entryLabel}, ואחריו ${steps.length} שלבים`}
        className="max-w-full"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--border)" />
          </marker>
        </defs>

        {/* ── כניסה ── */}
        <g>
          <rect
            x={x(0)}
            y={PAD}
            width={BOX_W}
            height={BOX_H}
            rx={14}
            className="fill-[var(--background)] stroke-[var(--border)]"
            strokeWidth={1.5}
          />
          <text
            x={x(0) + BOX_W / 2}
            y={PAD + 28}
            textAnchor="middle"
            className="fill-[var(--subtle)] text-[11px]"
          >
            נכנסים למסע
          </text>
          <text
            x={x(0) + BOX_W / 2}
            y={PAD + 50}
            textAnchor="middle"
            className="fill-[var(--foreground)] text-[13px] font-medium"
          >
            {truncate(entryLabel, 24)}
          </text>
        </g>

        {steps.map((step, i) => {
          const left = x(i + 1);
          const prevRight = x(i) + BOX_W;
          const isEmail = step.channel === "email";

          return (
            <g key={step.position}>
              {/* החץ, והתווית שמעליו — ההמתנה יושבת על הקשת ולא בתוך התיבה,
                  כי היא מתארת את המעבר ולא את הפעולה. */}
              <line
                x1={prevRight}
                y1={midY}
                x2={left - 8}
                y2={midY}
                stroke="var(--border)"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
              <text
                x={(prevRight + left) / 2}
                y={midY - 10}
                textAnchor="middle"
                className="fill-[var(--subtle)] text-[11px]"
              >
                {step.waitDays === 0 ? "מיד" : `${step.waitDays} ימים`}
              </text>

              <rect
                x={left}
                y={PAD}
                width={BOX_W}
                height={BOX_H}
                rx={14}
                className={
                  isEmail
                    ? "fill-sky-50 stroke-sky-300"
                    : "fill-emerald-50 stroke-emerald-300"
                }
                strokeWidth={1.5}
              />
              <text
                x={left + BOX_W / 2}
                y={PAD + 26}
                textAnchor="middle"
                className={isEmail ? "fill-sky-700 text-[11px]" : "fill-emerald-700 text-[11px]"}
              >
                {isEmail ? "מייל" : "וואטסאפ"}
              </text>
              <text
                x={left + BOX_W / 2}
                y={PAD + 47}
                textAnchor="middle"
                className="fill-[var(--foreground)] text-[13px] font-medium"
              >
                {truncate(step.templateName, 22)}
              </text>
              {step.stopIfReplied && (
                <text
                  x={left + BOX_W / 2}
                  y={PAD + 66}
                  textAnchor="middle"
                  className="fill-[var(--subtle)] text-[10px]"
                >
                  עוצר אם ענה
                </text>
              )}
            </g>
          );
        })}

        {/* סוף המסע — קו קצר שמסמן שאין המשך, כדי שהתיבה האחרונה לא תיראה
            כאילו נקטעה. */}
        <line
          x1={x(steps.length) + BOX_W}
          y1={midY}
          x2={x(steps.length) + BOX_W + 24}
          y2={midY}
          stroke="var(--border)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      </svg>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
