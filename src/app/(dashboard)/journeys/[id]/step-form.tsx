"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  MESSAGE_CHANNELS,
  STEP_TIMINGS,
  STEP_TIMING_LABELS,
} from "@/lib/supabase/database.types";
import { addNodeAction, updateNodeAction } from "./graph-actions";
import type { CanvasNode, CanvasTemplate } from "./canvas";

/**
 * הטופס האחד של הכרטיסייה — יצירה ועריכה.
 *
 * עד עכשיו היו שני טפסים כמעט זהים: הוספה ב-page.tsx ועריכה ב-canvas.tsx,
 * וכל שיפור היה צריך להיכתב פעמיים. עכשיו יש מקום אחד, וההבדל היחיד בין
 * המצבים הוא מקור הערכים: כרטיסייה קיימת (עריכה) או מיקום טיוטה (יצירה).
 *
 * השליחה עוברת דרך onSubmit ולא דרך action של הטופס, משתי סיבות: היצירה
 * צריכה לקבל חזרה את ה-id של הכרטיסייה כדי לפתוח אותה מסומנת, וכפתור
 * שנשלח פעמיים ברצף יצר בעבר כרטיסיות כפולות — הנעילה בזמן ההמתנה דורשת
 * לדעת שהשליחה רצה.
 */

export function StepForm({
  journeyId,
  templates,
  node,
  draftPos,
  onSaved,
}: {
  journeyId: string;
  templates: CanvasTemplate[];
  /** כרטיסייה קיימת = מצב עריכה. */
  node?: CanvasNode;
  /** מיקום על המשטח = מצב יצירה. */
  draftPos?: { x: number; y: number };
  /** נקרא אחרי יצירה מוצלחת, עם ה-id של הכרטיסייה החדשה. */
  onSaved?: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isNew = !node;

  if (!templates.length) {
    return (
      <p className="text-sm text-[var(--danger)]">
        אין עדיין תבניות במערכת. צרו אחת ב
        <Link href="/templates" className="underline">
          עמוד תבניות הודעה
        </Link>{" "}
        — בלעדיה אי אפשר להוסיף כרטיסייה.
      </p>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    const data = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        if (isNew) {
          const { id } = await addNodeAction(data);
          onSaved?.(id);
        } else {
          await updateNodeAction(data);
        }
      } catch {
        setError("השמירה נכשלה. נסו שוב.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <input type="hidden" name="journey_id" value={journeyId} />
      {node ? (
        <input type="hidden" name="id" value={node.id} />
      ) : (
        <>
          <input type="hidden" name="pos_x" value={draftPos?.x ?? 40} />
          <input type="hidden" name="pos_y" value={draftPos?.y ?? 140} />
        </>
      )}

      <label className="field-label">
        שם על הכרטיסייה
        <input
          name="label"
          defaultValue={node?.label ?? ""}
          className="input"
          placeholder="תזכורת ערב לפני"
          maxLength={60}
        />
      </label>

      <label className="field-label">
        ערוץ
        <select name="channel" className="input" required defaultValue={node?.channel ?? "whatsapp"}>
          {MESSAGE_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c === "email" ? "מייל" : "וואטסאפ"}
            </option>
          ))}
        </select>
      </label>

      <label className="field-label">
        תבנית
        <select name="template_id" className="input" required defaultValue={node?.templateId ?? ""}>
          <option value="" disabled>
            בחרו תבנית
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.channel === "whatsapp" && !t.metaTemplateName ? " (בלי תבנית ב-Meta)" : ""}
            </option>
          ))}
        </select>
      </label>

      {/*
        שלושת סוגי התזמון מוצגים יחד ולא מאחורי בורר שמחליף שדות. השרת ממילא
        קורא רק את השדות הרלוונטיים לסוג שנבחר, כך שהצגת הכול אינה מסתירה
        מהמשתמש מה קיים. (הצגה דינמית לפי הסוג — שלב 3 של השיפוץ.)
      */}
      <label className="field-label md:col-span-3">
        מתי לשלוח
        <select name="timing" className="input" required defaultValue={node?.timing ?? "relative"}>
          {STEP_TIMINGS.map((t) => (
            <option key={t} value={t}>
              {STEP_TIMING_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 md:col-span-3">
        <p className="mb-3 text-xs text-[var(--muted)]">
          מלאו רק את השורה שמתאימה לסוג שבחרתם למעלה.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="field-label">
            אחרי הקודמת — ימים
            <input
              name="wait_days"
              type="number"
              min={0}
              max={365}
              defaultValue={node?.waitDays ?? 0}
              className="input"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">0 = מיד</span>
          </label>

          <label className="field-label">
            מרחק מהפגישה
            <select
              name="offset_minutes"
              className="input"
              defaultValue={String(node?.offsetMinutes ?? -60)}
            >
              {OFFSET_OPTIONS.map((o) => (
                <option key={o.minutes} value={o.minutes}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field-label">
            שעה ביום, סביב הפגישה
            <div className="flex gap-2">
              <select name="day_offset" className="input" defaultValue={String(node?.dayOffset ?? 0)}>
                <option value="0">ביום הפגישה</option>
                <option value="-1">יום לפני</option>
                <option value="-2">יומיים לפני</option>
                <option value="-7">שבוע לפני</option>
              </select>
              <select
                name="day_at_minutes"
                className="input"
                defaultValue={String(node?.dayAtMinutes ?? 540)}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h.minutes} value={h.minutes}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-xs font-normal text-[var(--subtle)]">
              בשעון של הלקוח, לפי אזור הזמן שבחר בהזמנה.
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 md:col-span-3">
        <button type="submit" disabled={isPending} className="btn-primary disabled:opacity-60">
          {isPending ? "שומר…" : isNew ? "הוסף כרטיסייה" : "שמור שינויים"}
        </button>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
    </form>
  );
}

/**
 * מרחקים מהפגישה, בדקות. שליליים = לפני.
 *
 * רשימה סגורה ולא שדה חופשי: הערך הוא מספר שלילי, וזו בדיוק הצורה שקל
 * לטעות בה — "60" במקום "-60" היה הופך תזכורת לשעה *אחרי* הפגישה.
 */
const OFFSET_OPTIONS = [
  { minutes: -60, label: "שעה לפני" },
  { minutes: -120, label: "שעתיים לפני" },
  { minutes: -180, label: "שלוש שעות לפני" },
  { minutes: -1440, label: "יום לפני" },
  { minutes: 0, label: "במועד הפגישה" },
  { minutes: 60, label: "שעה אחרי" },
  { minutes: 1440, label: "יום אחרי" },
];

const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => {
  const minutes = (i + 6) * 60;
  return { minutes, label: `${String(i + 6).padStart(2, "0")}:00` };
});
