"use client";

import type { CSSProperties } from "react";

import { useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
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
import { StepForm } from "./step-form";

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
  templateId: string;
  templateName: string;
  channel: "whatsapp" | "email";
  waitDays: number;
  relativeAtMinutes: number | null;
  offsetMinutes: number;
  timing: StepTiming;
  dayOffset: number;
  dayAtMinutes: number;
}

/** התבניות הזמינות לבחירה בפאנל, עם התוכן להצגה. */
export interface CanvasTemplate {
  id: string;
  name: string;
  channel: string;
  body: string;
  metaTemplateName: string | null;
  metaStatus: string | null;
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
  bookingEntry,
  nodes,
  edges,
  templates,
}: {
  journeyId: string;
  entryLabel: string;
  /** האם הכניסה למסע היא "קבע פגישה" — קובע אילו תזמונים מוצעים בטופס. */
  bookingEntry: boolean;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  templates: CanvasTemplate[];
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // מיקום של כרטיסיית טיוטה: מופיעה מיד על המשטח, נשמרת למסד רק ב"הוסף".
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [, startTransition] = useTransition();

  // נקודת ההתחלה של הגרירה, כדי להבחין בין לחיצה לגרירה. בלי הסף הזה כל
  // ניסיון להזיז כרטיסייה היה גם פותח את הפאנל, וכל לחיצה הייתה נחשבת גרירה
  // ושומרת מיקום זהה.
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const CLICK_SLOP = 4;

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
    pressStart.current = { x: e.clientX, y: e.clientY };
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

  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    const id = drag.id;
    const start = pressStart.current;
    pressStart.current = null;

    const moved =
      !start ||
      Math.abs(e.clientX - start.x) > CLICK_SLOP ||
      Math.abs(e.clientY - start.y) > CLICK_SLOP;

    setDrag(null);

    // כמעט לא זז = לחיצה. פותחים את הפאנל ולא שומרים מיקום.
    if (!moved) {
      setPositions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setDraft(null);
      setSelectedId((cur) => (cur === id ? null : id));
      return;
    }

    const p = positions[id];
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

  /** פתיחת טיוטה: כרטיסייה מסומנת נסגרת — פאנל אחד פתוח בכל רגע. */
  function openDraft(pos: { x: number; y: number }) {
    setDraft(pos);
    setSelectedId(null);
    setConnectFrom(null);
  }

  // מקום פנוי לכרטיסייה מכפתור ההוספה — אותה נוסחת רשת ששימשה את הטופס הישן.
  const freeSpot = () => ({
    x: 40 + ((nodes.length + 1) % 4) * 230,
    y: 140 + Math.floor((nodes.length + 1) / 4) * 130,
  });

  // לחיצה כפולה על שטח ריק יוצרת טיוטה שם, ממורכזת סביב נקודת הלחיצה.
  // ה-scroll מתווסף כי המיקומים נמדדים בתוך התוכן הנגלל, לא בחלון הנראה.
  function onSurfaceDoubleClick(e: React.MouseEvent) {
    const el = surface.current;
    if (!el || e.target !== el) return;
    const rect = el.getBoundingClientRect();
    openDraft({
      x: Math.max(0, Math.round(e.clientX - rect.left + el.scrollLeft - CARD_W / 2)),
      y: Math.max(0, Math.round(e.clientY - rect.top + el.scrollTop - CARD_H / 2)),
    });
  }

  const selected = selectedId ? (nodes.find((n) => n.id === selectedId) ?? null) : null;
  const incoming = selected ? edges.filter((e) => e.toId === selected.id) : [];
  const outgoing = selected ? edges.filter((e) => e.fromId === selected.id) : [];
  const nameOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? n.label || n.templateName : "—";
  };

  // גובה המשטח נגזר מהכרטיסייה הנמוכה ביותר, עם מרווח לגרירה כלפי מטה.
  const maxY = Math.max(entryPos.y, draft?.y ?? 0, ...nodes.map((n) => posOf(n).y)) + CARD_H;
  const maxX = Math.max(entryPos.x, draft?.x ?? 0, ...nodes.map((n) => posOf(n).x)) + CARD_W;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button onClick={() => openDraft(freeSpot())} className="btn-primary text-sm">
          + כרטיסייה חדשה
        </button>
      </div>

      {connectFrom && (
        <div className="rounded-xl px-4 py-2 text-sm"
          style={{ backgroundColor: "var(--warn-soft)", color: "var(--warn)" }}>
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
        onDoubleClick={onSurfaceDoubleClick}
        dir="ltr"
        className="relative overflow-auto rounded-2xl border border-[var(--border)]"
        style={{
          height: Math.max(320, maxY + 80),
          minWidth: maxX + 80,
          backgroundColor: "var(--background)",
          // רשת נקודות: נותנת ללוח תחושת משטח שאפשר לסדר עליו, ומראה
          // שהמיקום של כרטיסייה הוא בחירה ולא סתם איפה שהיא נפלה.
          backgroundImage: "radial-gradient(circle, var(--border-strong) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          boxShadow: "inset 0 1px 3px rgb(23 30 27 / 0.05)",
        }}
      >
        {/* החצים מתחת לכרטיסיות, כדי שלא יחצו אותן */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-[var(--muted)]" />
            </marker>
            <marker id="ah-c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--warn)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const a = centerOf(edge.fromId ?? ENTRY_ID);
            const b = centerOf(edge.toId);
            if (!a || !b) return null;
            const conditional = edge.condition !== "always";
            return (
              <g key={edge.id}>
                <path
                  d={curve(a.x, a.y, b.x, b.y)}
                  fill="none"
                  stroke={conditional ? "var(--warn)" : "var(--border-strong)"}
                  strokeWidth={1.8}
                  strokeDasharray={conditional ? "5 4" : undefined}
                  markerEnd={conditional ? "url(#ah-c)" : "url(#ah)"}
                />
                {conditional && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    textAnchor="middle"
                    className="text-[10px]"
                    fill="var(--warn)"
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
          className="absolute flex flex-col justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 shadow-sm"
        >
          <p className="text-[11px] text-[var(--subtle)]">נכנסים למסע</p>
          <p className="mt-0.5 text-sm leading-snug font-medium">{entryLabel}</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConnectFrom(ENTRY_ID);
            }}
            title="משוך חץ מכאן"
            className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[10px] leading-none text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
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
                selectedId === node.id ? "ring-2 ring-[var(--primary)]" : ""
              } ${
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
                className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[10px] leading-none text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
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
                <DeleteButton />
              </form>
            </div>
          );
        })}

        {/* ── כרטיסיית טיוטה: קיימת רק על המסך עד השמירה ── */}
        {draft && (
          <div
            style={{ left: draft.x, top: draft.y, width: CARD_W, height: CARD_H }}
            className="absolute flex flex-col justify-center rounded-2xl border-2 border-dashed border-[var(--primary)] bg-[var(--surface)]/85 px-4"
          >
            <p className="text-[11px] text-[var(--subtle)]">טיוטה — עוד לא נשמרה</p>
            <p className="mt-0.5 text-sm leading-snug font-medium">כרטיסייה חדשה</p>
          </div>
        )}
      </div>

      {/* ── פאנל יצירה: אותו טופס של העריכה, במצב טיוטה ── */}
      {draft && (
        <div className="rounded-2xl border-2 border-dashed border-[var(--primary)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">כרטיסייה חדשה</h3>
            <button
              onClick={() => setDraft(null)}
              className="text-sm text-[var(--muted)] hover:underline"
            >
              ביטול
            </button>
          </div>
          <StepForm
            journeyId={journeyId}
            templates={templates}
            bookingEntry={bookingEntry}
            draftPos={draft}
            onSaved={(id) => {
              setDraft(null);
              setSelectedId(id);
            }}
          />
        </div>
      )}

      {/* ── פאנל הכרטיסייה הנבחרת ── */}
      {selected && (
        <div className="rounded-2xl border-2 border-[var(--primary)] bg-[var(--surface)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{selected.label || selected.templateName}</h3>
            <button
              onClick={() => setSelectedId(null)}
              className="text-sm text-[var(--muted)] hover:underline"
            >
              סגור
            </button>
          </div>

          {/* התוכן שיישלח מוצג בתוך הטופס עצמו, חי עם בחירת התבנית. */}

          {/* ── מי מגיע לכאן, ולאן ממשיכים ── */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">מי מגיע לכאן</p>
              {incoming.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {incoming.map((e) => (
                    <li key={e.id}>
                      {e.fromId ? nameOf(e.fromId) : "כניסה"}
                      {e.condition !== "always" && (
                        <span className="pill mr-2"
                          style={{ "--pill-color": "var(--warn)", "--pill-bg": "var(--warn-soft)" } as CSSProperties}>
                          {JOURNEY_CONDITION_LABELS[e.condition]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--danger)]">אף אחד — הכרטיסייה מנותקת</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted)]">ולאן ממשיכים</p>
              {outgoing.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {outgoing.map((e) => (
                    <li key={e.id}>
                      {nameOf(e.toId)}
                      {e.condition !== "always" && (
                        <span className="pill mr-2"
                          style={{ "--pill-color": "var(--warn)", "--pill-bg": "var(--warn-soft)" } as CSSProperties}>
                          {JOURNEY_CONDITION_LABELS[e.condition]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--subtle)]">סוף מסלול</p>
              )}
            </div>
          </div>

          {/* ── עריכה ── */}
          <div className="border-t border-[var(--border)] pt-4">
            {/* key מאפס את ערכי הטופס במעבר בין כרטיסיות — בלעדיו defaultValue
                של הכרטיסייה הקודמת היה נשאר על המסך. */}
            <StepForm
              key={selected.id}
              journeyId={journeyId}
              templates={templates}
              bookingEntry={bookingEntry}
              node={selected}
            />
          </div>
        </div>
      )}

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
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-xs"
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
        מוסיפים כרטיסייה בכפתור למעלה, או בלחיצה כפולה על מקום ריק במשטח.{" "}
        <strong>כל כרטיסייה מתוזמנת בנפרד</strong> — אפשר לערבב באותו מסע מייל מיד עם
        הקביעה, תזכורת ערב לפני, ותזכורת שעה לפני. גררו כרטיסייה כדי להזיז אותה. לחצו
        על <strong>→</strong> שבצידה, ואז על כרטיסייה אחרת, כדי למתוח חץ ביניהן. שני
        חצים מאותה כרטיסייה עם תנאים שונים הם שני מסלולים —{" "}
        <strong>אבל חץ &quot;תמיד&quot; בולע את מה שאחריו</strong>, כי הראשון שמתאים
        הוא זה שנבחר.
      </p>
    </div>
  );
}

/** תיאור התזמון בשפה שקוראים אותה בסריקה מהירה, לא במספרים. */
function timingLabel(n: {
  timing: StepTiming;
  waitDays: number;
  relativeAtMinutes: number | null;
  offsetMinutes: number;
  dayOffset: number;
  dayAtMinutes: number;
}): string {
  if (n.timing === "relative") {
    if (n.relativeAtMinutes == null) return n.waitDays === 0 ? "מיד" : `${n.waitDays} ימים אחרי`;
    const at = `${String(Math.floor(n.relativeAtMinutes / 60)).padStart(2, "0")}:${String(
      n.relativeAtMinutes % 60
    ).padStart(2, "0")}`;
    return n.waitDays === 0 ? `ב-${at} הקרוב` : `${n.waitDays} ימים אחרי, ב-${at}`;
  }

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

/** כפתור מחיקה שננעל בזמן שהמחיקה רצה, כדי שלחיצה כפולה לא תירה פעמיים. */
function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title="מחק כרטיסייה"
      className="size-5 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[11px] leading-none text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50"
    >
      ×
    </button>
  );
}

/**
 * עקומת בזייה בין שתי נקודות. נקודות הבקרה נשענות על המרחק האופקי וחסומות
 * ב-90, אחרת חוט כמעט-אנכי מתקפל על עצמו. הכיוון נגזר מסימן ההפרש, כך
 * שהעקומה נכונה גם כשהיעד מימין למקור וגם כשהוא משמאלו.
 */
function curve(sx: number, sy: number, tx: number, ty: number): string {
  const dx = tx - sx;
  const depth = Math.max(24, Math.min(Math.abs(dx) * 0.5, 90));
  const dir = Math.sign(dx) || 1;
  return `M ${sx} ${sy} C ${sx + dir * depth} ${sy}, ${tx - dir * depth} ${ty}, ${tx} ${ty}`;
}
