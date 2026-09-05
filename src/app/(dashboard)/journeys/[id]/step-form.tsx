"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StepTiming } from "@/lib/supabase/database.types";
import { addNodeAction, updateNodeAction } from "./graph-actions";
import type { CanvasNode, CanvasTemplate } from "./canvas";

/**
 * הטופס האחד של הכרטיסייה — יצירה ועריכה.
 *
 * עד עכשיו היו שני טפסים כמעט זהים: הוספה ב-page.tsx ועריכה ב-canvas.tsx,
 * וכל שיפור היה צריך להיכתב פעמיים. עכשיו יש מקום אחד, וההבדל היחיד בין
 * המצבים הוא מקור הערכים: כרטיסייה קיימת (עריכה) או מיקום טיוטה (יצירה).
 *
 * הבחירה מתחילה מהתבנית, ומה שייכתב ללקוח מוצג מיד מתחתיה — בעבר בחרו לפי
 * שם בלבד, והתוכן התגלה רק אחרי השמירה. אין שדה ערוץ: הערוץ נגזר מהתבנית
 * בשרת, כי בטופס הישן אפשר היה לבחור תבנית מייל עם ערוץ וואטסאפ.
 *
 * השליחה עוברת דרך onSubmit ולא דרך action של הטופס, משתי סיבות: היצירה
 * צריכה לקבל חזרה את ה-id של הכרטיסייה כדי לפתוח אותה מסומנת, וכפתור
 * שנשלח פעמיים ברצף יצר בעבר כרטיסיות כפולות — הנעילה בזמן ההמתנה דורשת
 * לדעת שהשליחה רצה.
 */

export function StepForm({
  journeyId,
  templates,
  bookingEntry,
  node,
  draftPos,
  onSaved,
}: {
  journeyId: string;
  templates: CanvasTemplate[];
  /** האם הכניסה למסע היא "קבע פגישה" — רק אז יש פגישה לעגן אליה תזמון. */
  bookingEntry: boolean;
  /** כרטיסייה קיימת = מצב עריכה. */
  node?: CanvasNode;
  /** מיקום על המשטח = מצב יצירה. */
  draftPos?: { x: number; y: number };
  /** נקרא אחרי יצירה מוצלחת, עם ה-id של הכרטיסייה החדשה. */
  onSaved?: (id: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // התבנית נשלטת (ולא defaultValue) כדי שהתצוגה המקדימה תתעדכן עם הבחירה.
  const [templateId, setTemplateId] = useState(node?.templateId ?? "");
  // גם התזמון נשלט, כי שורת הדוגמה ("תישלח ביום שלישי ב-20:00") מחושבת ממנו.
  const [timing, setTiming] = useState<StepTiming>(node?.timing ?? "relative");
  const [waitDays, setWaitDays] = useState(node?.waitDays ?? 0);
  const [relativeAt, setRelativeAt] = useState<number | null>(node?.relativeAtMinutes ?? null);
  const [offsetMinutes, setOffsetMinutes] = useState(node?.offsetMinutes ?? -60);
  const [dayOffset, setDayOffset] = useState(node?.dayOffset ?? 0);
  const [dayAtMinutes, setDayAtMinutes] = useState(node?.dayAtMinutes ?? 540);
  const isNew = !node;

  // משפט-תזמון שנבחר מודגש; השאר מעומעמים אבל לחיצים — נגיעה בשדה של
  // משפט אחר בוחרת אותו, כך שאין מצב של מילוי שדה שלא ייקרא.
  const timingCard = (t: StepTiming) =>
    `flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border-2 px-4 py-3 text-sm cursor-pointer ${
      timing === t
        ? "border-[var(--primary)] bg-[var(--surface)]"
        : "border-[var(--border)] bg-[var(--background)] text-[var(--muted)]"
    }`;

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

      {/*
        התבניות הן כרטיסי בחירה, לא בורר נפתח: השם, הערוץ ומצב האישור ב-Meta
        גלויים עוד לפני הבחירה, והכרטיס הנבחר נפתח ומציג את ההודעה במלואה.
        אין שדה ערוץ — הוא נגזר מהתבנית בשרת, ואי-התאמה בלתי אפשרית.
      */}
      <div className="flex flex-col gap-2 md:col-span-3">
        <p className="text-sm font-medium">מה שולחים</p>
        {templates.map((t) => {
          const active = t.id === templateId;
          return (
            <div
              key={t.id}
              onClick={() => setTemplateId(t.id)}
              className={`cursor-pointer rounded-xl border-2 px-4 py-3 ${
                active
                  ? "border-[var(--primary)] bg-[var(--surface)]"
                  : "border-[var(--border)] bg-[var(--background)]"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name="template_id"
                  value={t.id}
                  required
                  checked={active}
                  onChange={() => setTemplateId(t.id)}
                />
                <span className={`text-sm font-medium ${active ? "" : "text-[var(--muted)]"}`}>
                  {t.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    t.channel === "email"
                      ? "bg-[var(--nav-blue-soft)] text-[var(--nav-blue)]"
                      : "bg-[var(--ok-soft)] text-[var(--ok)]"
                  }`}
                >
                  {t.channel === "email" ? "מייל" : "וואטסאפ"}
                </span>
                {t.channel === "whatsapp" && <MetaBadge template={t} />}
              </div>

              {active && (
                <div className="mt-2">
                  <p
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      t.channel === "email" ? "bg-[var(--nav-blue-soft)]" : "bg-[var(--ok-soft)]"
                    }`}
                  >
                    {t.body}
                  </p>
                  {t.metaTemplateName && (
                    <p className="mt-1.5 text-xs text-[var(--subtle)]" dir="ltr">
                      Meta: {t.metaTemplateName}
                      {t.metaStatus ? ` (${t.metaStatus})` : ""}
                    </p>
                  )}
                  {t.channel === "whatsapp" && !t.metaTemplateName && (
                    <p className="mt-1.5 text-xs text-[var(--danger)]">
                      אין לתבנית הזו אישור ב-Meta — ללקוח שלא כתב לכם ב-24 השעות
                      האחרונות השליחה תיכשל.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!templateId && (
          <p className="px-1 text-xs text-[var(--subtle)]">
            בחרו תבנית — ההודעה שתישלח ללקוח תוצג במלואה בתוך הכרטיס.
          </p>
        )}
      </div>

      {/*
        התזמון הוא שלושה משפטים בעברית עם חורים למילוי, לא בורר-סוג ושדות
        מנותקים. בוחרים משפט וממלאים רק את החורים שבו — אין מה לזכור איזה
        שדה שייך לאיזה סוג, והשרת ממילא קורא רק את השדות של הסוג שנבחר.
      */}
      <div className="flex flex-col gap-2 md:col-span-3">
        <p className="text-sm font-medium">מתי לשלוח</p>

        <div className={timingCard("relative")} onClick={() => setTiming("relative")}>
          <input
            type="radio"
            name="timing"
            value="relative"
            checked={timing === "relative"}
            onChange={() => setTiming("relative")}
          />
          <span>שלחו</span>
          <input
            name="wait_days"
            type="number"
            min={0}
            max={365}
            value={waitDays}
            onChange={(e) => setWaitDays(Math.max(0, Number(e.target.value) || 0))}
            className="input w-20"
          />
          <span>ימים אחרי הכרטיסייה הקודמת, בשעה</span>
          <select
            name="relative_at_minutes"
            className="input w-auto"
            value={relativeAt === null ? "" : String(relativeAt)}
            onChange={(e) => setRelativeAt(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">שבה נשלחה הקודמת</option>
            {HOUR_OPTIONS.map((h) => (
              <option key={h.minutes} value={h.minutes}>
                {h.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--subtle)]">(0 ימים = באותו יום)</span>
        </div>

        {/* בלי כניסת "קבע פגישה" אין פגישה לעגן אליה, והמשפטים לא מוצגים —
            ולידציה דרך אי-אפשרות. התנאי כולל את התזמון הנוכחי כדי שכרטיסייה
            ישנה עם עיגון-פגישה במסע אחר עדיין תוצג ותהיה ניתנת לתיקון. */}
        {!bookingEntry && timing !== "booking_offset" && timing !== "booking_day_at" ? (
          <p className="px-1 text-xs text-[var(--subtle)]">
            תזמון סביב פגישה אפשרי רק במסע שהכניסה אליו היא &quot;קבע פגישה&quot; —
            במסע הזה אין פגישה לעגן אליה.
          </p>
        ) : (
          <>
        <div className={timingCard("booking_offset")} onClick={() => setTiming("booking_offset")}>
          <input
            type="radio"
            name="timing"
            value="booking_offset"
            checked={timing === "booking_offset"}
            onChange={() => setTiming("booking_offset")}
          />
          <span>שלחו ביחס למועד הפגישה:</span>
          <select
            name="offset_minutes"
            className="input w-auto"
            value={String(offsetMinutes)}
            onChange={(e) => setOffsetMinutes(Number(e.target.value))}
          >
            {OFFSET_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={timingCard("booking_day_at")} onClick={() => setTiming("booking_day_at")}>
          <input
            type="radio"
            name="timing"
            value="booking_day_at"
            checked={timing === "booking_day_at"}
            onChange={() => setTiming("booking_day_at")}
          />
          <span>שלחו</span>
          <select
            name="day_offset"
            className="input w-auto"
            value={String(dayOffset)}
            onChange={(e) => setDayOffset(Number(e.target.value))}
          >
            <option value="0">ביום הפגישה</option>
            <option value="-1">יום לפני הפגישה</option>
            <option value="-2">יומיים לפני הפגישה</option>
            <option value="-7">שבוע לפני הפגישה</option>
          </select>
          <span>בשעה</span>
          <select
            name="day_at_minutes"
            className="input w-auto"
            value={String(dayAtMinutes)}
            onChange={(e) => setDayAtMinutes(Number(e.target.value))}
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h.minutes} value={h.minutes}>
                {h.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-[var(--subtle)]">בשעון של הלקוח</span>
        </div>
          </>
        )}

        <p className="rounded-xl bg-[var(--nav-blue-soft)] px-4 py-2.5 text-sm text-[var(--nav-blue)]">
          {timingExample(timing, waitDays, relativeAt, offsetMinutes, dayOffset, dayAtMinutes)}
        </p>
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

/** מצב האישור של תבנית וואטסאפ ב-Meta, כתג צבעוני שרואים לפני הבחירה. */
function MetaBadge({ template }: { template: CanvasTemplate }) {
  if (!template.metaTemplateName) {
    return (
      <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] text-[var(--danger)]">
        בלי אישור ב-Meta
      </span>
    );
  }
  if (template.metaStatus && template.metaStatus.toUpperCase() !== "APPROVED") {
    return (
      <span className="rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] text-[var(--warn)]">
        ממתינה לאישור ב-Meta
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[var(--ok-soft)] px-2 py-0.5 text-[11px] text-[var(--ok)]">
      מאושרת ב-Meta
    </span>
  );
}

/**
 * תרגום התזמון המופשט לדוגמה קונקרטית: "יום לפני ב-20:00" הופך ל"לפגישה
 * ביום רביעי — תישלח ביום שלישי". הדוגמה מעוגנת בפגישה דמיונית ביום רביעי
 * הקרוב ב-11:15, כי מול תאריך אמיתי קל לוודא שהכיוון נכון (לפני ולא אחרי).
 * "בסביבות" ולא שעה מדויקת — הקרון רץ כל רבע שעה.
 */
function timingExample(
  timing: StepTiming,
  waitDays: number,
  relativeAt: number | null,
  offsetMinutes: number,
  dayOffset: number,
  dayAtMinutes: number
): string {
  if (timing === "relative") {
    const days =
      waitDays === 0 ? "באותו יום" : waitDays === 1 ? "יום אחרי" : `${waitDays} ימים אחרי`;
    if (relativeAt == null) {
      if (waitDays === 0) return "תישלח מיד, ברגע שהלקוח מגיע לכרטיסייה הזו.";
      return `תישלח ${days} שהלקוח קיבל את הכרטיסייה הקודמת, באותה שעה.`;
    }
    const at = `${String(Math.floor(relativeAt / 60)).padStart(2, "0")}:${String(
      relativeAt % 60
    ).padStart(2, "0")}`;
    return `תישלח ${days}${waitDays === 0 ? "" : " הקודמת"}, בסביבות ${at} — ואם השעה כבר עברה, למחרת ב-${at}.`;
  }

  const booking = new Date();
  booking.setDate(booking.getDate() + (((3 - booking.getDay() + 7) % 7) || 7));
  booking.setHours(11, 15, 0, 0);

  const send = new Date(booking);
  if (timing === "booking_offset") {
    send.setMinutes(send.getMinutes() + offsetMinutes);
  } else {
    send.setDate(send.getDate() + dayOffset);
    send.setHours(0, dayAtMinutes, 0, 0);
  }

  // התאריך המספרי מכריע כשהיום בשבוע זהה — "שבוע לפני" הוא אותו יום רביעי.
  const day = (d: Date) =>
    `${d.toLocaleDateString("he-IL", { weekday: "long" })} ${d.getDate()}.${d.getMonth() + 1}`;
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return `לדוגמה: לפגישה ב${day(booking)} בשעה 11:15 — תישלח ב${day(send)} בסביבות ${hhmm(send)}.`;
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
