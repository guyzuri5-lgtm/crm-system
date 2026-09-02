"use client";

import { useRef, useState, useTransition } from "react";
import {
  JOURNEY_CONDITIONS,
  JOURNEY_CONDITION_LABELS,
  type JourneyCondition,
  type StepTiming,
} from "@/lib/supabase/database.types";
import {
  moveNodeAction,
  addEdgeAction,
  deleteEdgeAction,
  deleteNodeAction,
  setEdgeConditionAction,
} from "./graph-actions";

/**
 * משטח עריכת המסע.
 *
 * ── שלוש החלטות שקבעו את המבנה ──
 *
 * 1. הכרטיסיות הן HTML במיקום מוחלט, והחצים הם SVG *מתחתיהן*. ניסיתי גם את
 *    ההפך; טקסט ב-SVG לא נשבר לשורות, וכרטיסייה עם שם תבנית ארוך נחתכה.
 *
 * 2. הגרירה מעדכנת מצב מקומי בלבד, והשרת מקבל את המיקום רק בשחרור. עדכון
 *    לכל פיקסל היה מציף את המסד בכתיבות שכולן חוץ מהאחרונה חסרות ערך.
 *
 * 3. חיבור נעשה בלחיצה ולא בגרירה: לוחצים על נקודת החיבור של כרטיסייה, ואז
 *    על כרטיסייה אחרת. גרירת חץ נראית טבעית יותר אבל דורשת מעקב אחר הסמן
 *    מעל אלמנטים שמשתנים — ובמסך מגע היא כמעט בלתי אפשרית.
 */

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  label: string | null;
  templateName: string;
  channel: "whatsapp" | "email";
  waitDays: number;
  offsetMinutes: number;
  timing: StepTiming;
  dayOffset: number;
  dayAtMinutes: number;
}

export interface CanvasEdge {
  id: string;
  fromId: string | null;
  toId: string;
  condition: JourneyCondition;
}

const CARD_W = 190;
const CARD_H = 84;
const ENTRY_ID = "__entry__";

export function JourneyCanvas({
  journeyId,
  entryLabel,
  nodes,
  edges,
}: {
  journeyId: string;
  entryLabel: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // המיקום המקומי גובר בזמן גרירה; אחריה השרת מרענן ומחזיר את האמת.
  const posOf = (n: CanvasNode) => positions[n.id] ?? { x: n.x, y: n.y };

  // הכניסה אינה שורה במסד אלא צומת וירטואלי, ולכן מיקומה קבוע משמאל.
  const entryPos = { x: 20, y: 20 };
  const centerOf = (id: string) => {
    if (id === ENTRY_ID) return { x: entryPos.x + CARD_W / 2, y: entryPos.y + CARD_H / 2 };
    const node = nodes.find((n) => n.id === id);
    if (!node) return null;
    const p = posOf(node);
    return { x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 };
  };

  function onPointerDown(e: React.PointerEvent, node: CanvasNode) {
    if (connectFrom) return;
    const p = posOf(node);
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    setDrag({ id: node.id, dx: e.clientX - rect.left - p.x, dy: e.clientY - rect.top - p.y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    setPositions((prev) => ({
      ...prev,
      [drag.id]: {
        x: Math.max(0, e.clientX - rect.left - drag.dx),
        y: Math.max(0, e.clientY - rect.top - drag.dy),
      },
    }));
  }

  function onPointerUp() {
    if (!drag) return;
    const p = positions[drag.id];
    const id = drag.id;
    setDrag(null);
    if (!p) return;

    startTransition(async () => {
      const data = new FormData();
      data.set("id", id);
      data.set("journey_id", journeyId);
      data.set("pos_x", String(p.x));
      data.set("pos_y", String(p.y));
      await moveNodeAction(data);
    });
  }

  function connectTo(targetId: string) {
    if (!connectFrom || connectFrom === targetId) {
      setConnectFrom(null);
      return;
    }
    const from = connectFrom;
    setConnectFrom(null);

    startTransition(async () => {
      const data = new FormData();
      data.set("journey_id", journeyId);
      data.set("from_step_id", from === ENTRY_ID ? "entry" : from);
      data.set("to_step_id", targetId);
      await addEdgeAction(data);
    });
  }

  // גובה המשטח נגזר מהכרטיסייה הנמוכה ביותר, עם מרווח לגרירה כלפי מטה.
  const maxY = Math.max(entryPos.y, ...nodes.map((n) => posOf(n).y)) + CARD_H;
  const maxX = Math.max(entryPos.x, ...nodes.map((n) => posOf(n).x)) + CARD_W;

  return (
    <div className="flex flex-col gap-3">
      {connectFrom && (
        <div className="rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          מצב חיבור: לחצו על הכרטיסייה שאליה יימשך החץ.{" "}
          <button onClick={() => setConnectFrom(null)} className="underline">
            ביטול
          </button>
        </div>
      )}

      <div
        ref={surface}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        dir="ltr"
        className="relative overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--background)]"
        style={{ height: Math.max(320, maxY + 80), minWidth: maxX + 80 }}
      >
        {/* החצים מתחת לכרטיסיות, כדי שלא יחצו אותן */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--muted)]" />
            </marker>
            <marker id="ah-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#d97706" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const a = centerOf(edge.fromId ?? ENTRY_ID);
            const b = centerOf(edge.toId);
            if (!a || !b) return null;
            const conditional = edge.condition !== "always";
            return (
              <g key={edge.id}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={conditional ? "#d97706" : "var(--muted)"}
                  strokeWidth={1.5}
                  strokeDasharray={conditional ? "5 4" : undefined}
                  markerEnd={conditional ? "url(#ah-c)" : "url(#ah)"}
                />
                {conditional && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    textAnchor="middle"
                    className="text-[10px]"
                    fill="#b45309"
                  >
                    {JOURNEY_CONDITION_LABELS[edge.condition]}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* ── כניסה ── */}
        <div
          style={{ left: entryPos.x, top: entryPos.y, width: CARD_W, height: CARD_H }}
          onClick={() => connectFrom && connectTo(ENTRY_ID)}
          className="absolute flex flex-col justify-center rounded-2xl border border-[var(--border)] bg-white px-4 shadow-sm"
        >
          <p className="text-[11px] text-[var(--subtle)]">נכנסים למסע</p>
          <p className="mt-0.5 text-sm leading-snug font-medium">{entryLabel}</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConnectFrom(ENTRY_ID);
            }}
            title="משוך חץ מכאן"
            className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full border border-[var(--border)] bg-white text-[10px] leading-none text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            →
          </button>
        </div>

        {/* ── כרטיסיות ── */}
        {nodes.map((node) => {
          const p = posOf(node);
          const isTarget = Boolean(connectFrom) && connectFrom !== node.id;
          return (
            <div
              key={node.id}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
              onPointerDown={(e) => onPointerDown(e, node)}
              onClick={() => isTarget && connectTo(node.id)}
              className={`absolute flex flex-col justify-center rounded-2xl border-2 px-4 shadow-sm select-none ${
                drag?.id === node.id ? "cursor-grabbing" : "cursor-grab"
              } ${isTarget ? "ring-2 ring-amber-400" : ""} ${
                node.channel === "email"
                  ? "border-sky-300 bg-sky-50"
                  : "border-emerald-300 bg-emerald-50"
              }`}
            >
              <p className="text-[10px] text-[var(--subtle)]">
                {timingLabel(node)}
                {" · "}
                {node.channel === "email" ? "מייל" : "וואטסאפ"}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug font-medium break-words">
                {node.label || node.templateName}
              </p>

              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setConnectFrom(node.id);
                }}
                title="משוך חץ מכאן"
                className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full border border-[var(--border)] bg-white text-[10px] leading-none text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
              >
                →
              </button>

              <form
                action={deleteNodeAction}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -top-2 -left-2"
              >
                <input type="hidden" name="id" value={node.id} />
                <input type="hidden" name="journey_id" value={journeyId} />
                <button
                  type="submit"
                  title="מחק כרטיסייה"
                  className="size-5 rounded-full border border-[var(--border)] bg-white text-[11px] leading-none text-[var(--danger)] hover:bg-red-50"
                >
                  ×
                </button>
              </form>
            </div>
          );
        })}
      </div>

      {/* ── רשימת החצים ── */}
      {edges.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-[var(--muted)]">חצים</p>
          {edges.map((edge) => {
            const from = edge.fromId ? nodes.find((n) => n.id === edge.fromId) : null;
            const to = nodes.find((n) => n.id === edge.toId);
            return (
              <div
                key={edge.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs"
              >
                <span className="text-[var(--muted)]">
                  {edge.fromId ? (from?.label || from?.templateName || "—") : "כניסה"}
                  {" ← "}
                  {to?.label || to?.templateName || "—"}
                </span>

                <form action={setEdgeConditionAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={edge.id} />
                  <input type="hidden" name="journey_id" value={journeyId} />
                  <select
                    name="condition"
                    defaultValue={edge.condition}
                    className="rounded-md border border-[var(--border)] bg-white px-1.5 py-0.5 text-xs"
                  >
                    {JOURNEY_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {JOURNEY_CONDITION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-[var(--primary)] hover:underline">
                    עדכן
                  </button>
                </form>

                <form action={deleteEdgeAction}>
                  <input type="hidden" name="id" value={edge.id} />
                  <input type="hidden" name="journey_id" value={journeyId} />
                  <button type="submit" className="text-[var(--danger)] hover:underline">
                    מחק חץ
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-[var(--subtle)]">
        גררו כרטיסייה כדי להזיז אותה. לחצו על <strong>→</strong> שבצידה, ואז על כרטיסייה
        אחרת, כדי למתוח חץ ביניהן. שני חצים מאותה כרטיסייה עם תנאים שונים הם שני
        מסלולים — <strong>אבל חץ &quot;תמיד&quot; בולע את מה שאחריו</strong>, כי הראשון
        שמתאים הוא זה שנבחר.
      </p>
    </div>
  );
}

/** תיאור התזמון בשפה שקוראים אותה בסריקה מהירה, לא במספרים. */
function timingLabel(n: {
  timing: StepTiming;
  waitDays: number;
  offsetMinutes: number;
  dayOffset: number;
  dayAtMinutes: number;
}): string {
  if (n.timing === "relative") return n.waitDays === 0 ? "מיד" : `${n.waitDays} ימים אחרי`;

  if (n.timing === "booking_offset") {
    const m = n.offsetMinutes;
    if (m === 0) return "במועד הפגישה";
    const abs = Math.abs(m);
    const unit =
      abs % 1440 === 0 ? `${abs / 1440} ימים` : abs % 60 === 0 ? `${abs / 60} שעות` : `${abs} דק׳`;
    return m < 0 ? `${unit} לפני הפגישה` : `${unit} אחרי הפגישה`;
  }

  const hh = String(Math.floor(n.dayAtMinutes / 60)).padStart(2, "0");
  const mm = String(n.dayAtMinutes % 60).padStart(2, "0");
  const day =
    n.dayOffset === 0 ? "ביום הפגישה" : n.dayOffset === -1 ? "ערב לפני" : `${-n.dayOffset} ימים לפני`;
  return `${day} ב-${hh}:${mm}`;
}
