"use client";

import { useState, useTransition } from "react";
import { reorderStepsAction } from "../actions";
import {
  JOURNEY_CONDITION_LABELS,
  type JourneyCondition,
  type JourneyAnchor,
} from "@/lib/supabase/database.types";

/**
 * תרשים הזרימה של המסע — תיבות, חיצים, וגרירה לשינוי סדר.
 *
 * למה HTML ולא SVG: הגרסה הראשונה הייתה SVG, וזה עבד יפה כל עוד התרשים רק
 * *הציג*. ברגע שנוספה גרירה, SVG הפך לנטל — אין בו drag-and-drop מובנה, וכל
 * תיבה הייתה דורשת חישוב מיקום ידני. תיבות HTML בשורה מקבלות את זה מהדפדפן.
 * החיצים הם אלמנטים דקים בין התיבות; זה מספיק לטור אחד.
 *
 * הגרירה אופטימית: הסדר מתעדכן על המסך מיד, והשרת מקבל את התוצאה אחריו.
 * שמירה שנכשלת מציגה שגיאה — ורענון מחזיר את האמת מהמסד.
 */

export interface FlowStep {
  id: string;
  position: number;
  waitDays: number;
  offsetMinutes: number;
  channel: "whatsapp" | "email";
  templateName: string;
  condition: JourneyCondition;
}

export function JourneyFlow({
  journeyId,
  entryLabel,
  stopOnReply,
  anchor,
  steps,
}: {
  journeyId: string;
  entryLabel: string;
  stopOnReply: boolean;
  anchor: JourneyAnchor;
  steps: FlowStep[];
}) {
  const [order, setOrder] = useState(steps);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // steps מגיע מחדש בכל רענון של השרת. בלי היישור הזה, מחיקת שלב הייתה
  // משאירה על המסך את הרשימה הישנה עד לרענון מלא.
  const ids = steps.map((s) => s.id).join(",");
  const [lastIds, setLastIds] = useState(ids);
  if (ids !== lastIds && !pending) {
    setLastIds(ids);
    setOrder(steps);
  }

  if (!steps.length) {
    return (
      <p className="text-sm text-[var(--subtle)]">
        אין שלבים להציג. הוסיפו שלב ראשון ותראו אותו כאן.
      </p>
    );
  }

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    const next = [...order];
    const from = next.findIndex((s) => s.id === fromId);
    const to = next.findIndex((s) => s.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);

    startTransition(async () => {
      const data = new FormData();
      data.set("journey_id", journeyId);
      data.set("order", next.map((s) => s.id).join(","));
      await reorderStepsAction(data);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/*
        dir=ltr: הזרימה משמאל לימין כמו בכל תרשים זרימה, גם בדף עברי.
        הפיכתה הייתה הופכת את החיצים לבלתי קריאים.
      */}
      <div className="overflow-x-auto pb-2" dir="ltr">
        <div className="flex min-w-max items-stretch gap-0">
          <div className="flex w-44 shrink-0 flex-col justify-center rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3">
            <p className="text-[11px] text-[var(--subtle)]">נכנסים למסע</p>
            <p className="mt-1 text-sm font-medium">{entryLabel}</p>
          </div>

          {order.map((step) => (
            <div key={step.id} className="flex items-stretch">
              <Arrow
                label={
                  anchor === "booking"
                    ? offsetLabel(step.offsetMinutes)
                    : step.waitDays === 0
                      ? "מיד"
                      : `${step.waitDays} ימים`
                }
                condition={step.condition}
              />

              <div
                draggable
                onDragStart={() => setDragging(step.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging) move(dragging, step.id);
                  setDragging(null);
                }}
                className={`w-44 shrink-0 cursor-grab rounded-2xl border px-4 py-3 transition-opacity active:cursor-grabbing ${
                  dragging === step.id ? "opacity-40" : ""
                } ${
                  step.channel === "email"
                    ? "border-sky-300 bg-sky-50"
                    : "border-emerald-300 bg-emerald-50"
                }`}
              >
                <p
                  className={`text-[11px] ${step.channel === "email" ? "text-sky-700" : "text-emerald-700"}`}
                >
                  {step.channel === "email" ? "מייל" : "וואטסאפ"}
                </p>
                <p className="mt-1 text-sm leading-snug font-medium break-words">
                  {step.templateName}
                </p>
              </div>
            </div>
          ))}

          {/* קצה פתוח — מסמן שאין המשך, כדי שהתיבה האחרונה לא תיראה כאילו נקטעה */}
          <div className="flex w-8 items-center">
            <div className="h-px w-full border-t border-dashed border-[var(--border)]" />
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--subtle)]">
        גררו תיבה כדי לשנות את סדר השלבים.
        {pending && <span className="mr-2 text-[var(--primary)]">שומר…</span>}
        {!stopOnReply && (
          <>
            {" "}
            תגובה של הלקוח אינה מסיימת את המסע — התנאים על החיצים הם שקובעים מי ממשיך
            לאן.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * החץ בין שתי תיבות. ההמתנה והתנאי יושבים כאן ולא בתוך התיבה, כי שניהם
 * מתארים את *המעבר* — מתי עוברים ולמי מותר — ולא את הפעולה עצמה.
 */
function Arrow({
  label,
  condition,
}: {
  label: string;
  condition: JourneyCondition;
}) {
  const conditional = condition !== "always";

  return (
    <div className="flex w-28 shrink-0 flex-col items-center justify-center px-1">
      <span className="text-[11px] whitespace-nowrap text-[var(--subtle)]">{label}</span>

      <div className="my-1 flex w-full items-center">
        <div
          className={`h-px flex-1 ${conditional ? "border-t border-dashed border-amber-400" : "bg-[var(--border)]"}`}
        />
        <span
          className={`ml-[-1px] border-y-[5px] border-l-[7px] border-y-transparent ${
            conditional ? "border-l-amber-400" : "border-l-[var(--border)]"
          }`}
        />
      </div>

      {conditional && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-amber-700 ring-1 ring-amber-600/20 ring-inset">
          {JOURNEY_CONDITION_LABELS[condition]}
        </span>
      )}
    </div>
  );
}

/** "שעה לפני" קריא יותר מ-"‎-60 דקות" כשסורקים תרשים בעין. */
function offsetLabel(minutes: number): string {
  if (minutes === 0) return "במועד הפגישה";
  const abs = Math.abs(minutes);
  const unit =
    abs % 1440 === 0
      ? `${abs / 1440} ימים`
      : abs % 60 === 0
        ? `${abs / 60} שעות`
        : `${abs} דק׳`;
  return minutes < 0 ? `${unit} לפני` : `${unit} אחרי`;
}
