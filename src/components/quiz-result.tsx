// תצוגת תוצאת שאלון הצ'אקרות בתוך ה-CRM.
// אותה שפה ויזואלית של השאלון עצמו: גרף קו, דמות מדיטציה עם המרכז החסום
// מסומן, שבעת הציונים, וכל ההיגדים עם התשובה שנבחרה.
//
// רכיב שרת בלבד — אין כאן שום אינטראקטיביות, רק SVG ו-HTML.

import { formatDateTime } from "@/lib/dates";
import {
  CHAKRA_KEYS,
  CHAKRAS,
  flowStatus,
  SCALE_LABELS,
  type ChakraKey,
} from "@/lib/quiz";
import { QUIZ_KIND_LABELS, type QuizKind } from "@/lib/supabase/database.types";

export interface QuizSubmissionView {
  id: string;
  session_id: string;
  kind: QuizKind;
  lowest_chakra: string | null;
  lowest_chakra_name: string | null;
  scores: Record<string, number>;
  answers: { id: number; chakra: string; text: string; score: number | null }[];
  balance_index: number | null;
  spread: number | null;
  submitted_at: string;
  booking_clicked_at: string | null;
  utm: Record<string, string>;
}

function isChakraKey(v: string | null): v is ChakraKey {
  return v != null && (CHAKRA_KEYS as readonly string[]).includes(v);
}

function lowestOf(scores: Record<string, number>): ChakraKey {
  let best: ChakraKey = CHAKRA_KEYS[0];
  for (const k of CHAKRA_KEYS) if ((scores[k] ?? 0) < (scores[best] ?? 0)) best = k;
  return best;
}

/** גרף הקו — אותה גיאומטריה כמו בשאלון: השורש מימין, הכתר משמאל */
function LineGraph({ scores, lowest }: { scores: Record<string, number>; lowest: ChakraKey }) {
  const W = 700, H = 76, hi = 14, lo = 58;
  const pts = CHAKRA_KEYS.map((k, i) => ({
    k,
    x: 650 - i * 100,
    y: lo - ((scores[k] ?? 0) / 100) * (lo - hi),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y.toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
         aria-label="גרף מצב שבעת המרכזים" className="block h-14 w-full overflow-visible">
      <defs>
        <linearGradient id="qline" gradientUnits="userSpaceOnUse" x1="650" y1="0" x2="50" y2="0">
          {CHAKRA_KEYS.map((k, i) => (
            <stop key={k} offset={`${((i / 6) * 100).toFixed(1)}%`} stopColor={CHAKRAS[k].color} />
          ))}
        </linearGradient>
      </defs>
      <path d={line} fill="none" stroke="url(#qline)" strokeWidth="2.6"
            strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {pts.map((p) => (
        <g key={p.k}>
          {p.k === lowest && (
            <circle cx={p.x} cy={p.y.toFixed(1)} r="9" fill="none" stroke="#D6332B"
                    strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          )}
          <circle cx={p.x} cy={p.y.toFixed(1)} r="5" fill="#fff" stroke={CHAKRAS[p.k].color}
                  strokeWidth="3" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}

/** דמות המדיטציה, עם זוהר על המרכז החסום בלבד */
function Figure({ chakra }: { chakra: ChakraKey }) {
  const c = CHAKRAS[chakra];
  const p = c.body;
  return (
    <svg viewBox="0 0 200 170" role="img" aria-label={`דמות מדיטציה עם סימון ${c.name}`}
         className="mx-auto block w-full max-w-[130px]">
      <g fill="#D3C6B2">
        <path d="M100 104 C 140 104 174 126 174 142 C 174 156 141 162 100 162 C 59 162 26 156 26 142 C 26 126 60 104 100 104 Z" />
        <path d="M120 58 C 138 66 152 90 154 118" fill="none" stroke="#D3C6B2" strokeWidth="13" strokeLinecap="round" />
        <path d="M80 58 C 62 66 48 90 46 118" fill="none" stroke="#D3C6B2" strokeWidth="13" strokeLinecap="round" />
        <path d="M100 44 C 112 44 121 53 123 66 C 125 82 124 96 122 110 L 78 110 C 76 96 75 82 77 66 C 79 53 88 44 100 44 Z" />
        <circle cx="100" cy="26" r="16" />
      </g>
      <path d="M66 146 C 82 136 94 140 100 150" fill="none" stroke="#B6A68C" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M134 146 C 118 136 106 140 100 150" fill="none" stroke="#B6A68C" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx={p.x} cy={p.y} r="15" fill={c.color} opacity="0.2" />
      <circle cx={p.x} cy={p.y} r="9.5" fill={c.color} opacity="0.42" />
      <circle cx={p.x} cy={p.y} r="5.5" fill={c.color} />
      <circle cx={p.x} cy={p.y} r="5.5" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.9" />
    </svg>
  );
}

export function QuizResult({ submission }: { submission: QuizSubmissionView }) {
  const s = submission;
  const lowest = isChakraKey(s.lowest_chakra) ? s.lowest_chakra : lowestOf(s.scores);
  const lowestScore = s.scores[lowest] ?? 0;
  const st = flowStatus(lowestScore);

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">תוצאת שאלון הצ&apos;אקרות</h2>
          <p className="text-xs text-gray-500">
            {formatDateTime(s.submitted_at)} · {QUIZ_KIND_LABELS[s.kind]}
            {s.booking_clicked_at && " · יצא ליומן"}
          </p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: st.bg, color: st.color }}>
          {s.lowest_chakra_name ?? CHAKRAS[lowest].name} · {lowestScore}/100 · {st.label}
        </span>
      </div>

      <div className="rounded bg-gray-50 p-3">
        <LineGraph scores={s.scores} lowest={lowest} />
        <ul className="mt-1 grid grid-cols-7 gap-0.5">
          {CHAKRA_KEYS.map((k) => (
            <li key={k} className="text-center text-[10px] leading-tight text-gray-500">
              {CHAKRAS[k].short.map((w) => <span key={w} className="block">{w}</span>)}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[130px_1fr]">
        <div className="text-center">
          <Figure chakra={lowest} />
          <p className="mt-1 text-xs text-gray-500">{CHAKRAS[lowest].location}</p>
        </div>

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {CHAKRA_KEYS.map((k) => {
            const v = s.scores[k] ?? 0;
            const t = flowStatus(v);
            return (
              <div key={k} className="rounded border px-2 py-1">
                <span className="block text-[11px] text-gray-500">{CHAKRAS[k].name}</span>
                <b className="text-sm" style={{ color: t.color }}>{v}</b>
                <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-gray-200">
                  <span className="block h-full rounded-full"
                        style={{ width: `${Math.max(v, 2)}%`, background: CHAKRAS[k].color }} />
                </span>
              </div>
            );
          })}
          <div className="rounded border px-2 py-1">
            <span className="block text-[11px] text-gray-500">מדד איזון</span>
            <b className="text-sm">{s.balance_index ?? "—"}</b>
            <span className="block text-[10px] text-gray-400">פער {s.spread ?? "—"}</span>
          </div>
        </div>
      </div>

      {s.answers.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">
            כל {s.answers.length} התשובות
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {s.answers.map((a) => {
              const label = a.score != null ? SCALE_LABELS[a.score] ?? "—" : "—";
              const t = a.score == null ? flowStatus(50) : flowStatus((a.score / 3) * 100);
              return (
                <li key={a.id} className="flex items-baseline gap-2 rounded border px-2 py-1">
                  <span className="flex-1 text-xs text-gray-600">{a.id}. {a.text}</span>
                  <span className="shrink-0 rounded-full px-2 text-[11px] font-bold"
                        style={{ background: t.bg, color: t.color }}>{label}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-gray-400">
        מזהה לקישור מקלנדלי (utm_content): <span dir="ltr">{s.session_id}</span>
      </p>
    </div>
  );
}
