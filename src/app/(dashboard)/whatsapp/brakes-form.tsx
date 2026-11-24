"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (h: number) => String(h).padStart(2, "0");

/**
 * בלמי הוואטסאפ — עריכה במקום, בדף הוואטסאפ עצמו.
 *
 * המתג כאן עוצר את **הוואטסאפ** האוטומטי בלבד (whatsapp_paused). המתג הכללי,
 * שעוצר גם מייל וניוזלטר, נשאר בהגדרות ← בלמי שליחה.
 */
export function BrakesForm({
  initial,
  warmupDay,
  warmupLimit,
  onSave,
}: {
  initial: {
    whatsappPaused: boolean;
    dailyLimit: number;
    minGap: number;
    maxGap: number;
    warmupEnabled: boolean;
    quietEnabled: boolean;
    quietStart: number;
    quietEnd: number;
    quietShabbat: boolean;
  };
  /** היום בשבוע החימום (1–7), או null כשאין חימום פעיל. */
  warmupDay: number | null;
  /** התקרה שחלה היום בפועל. */
  warmupLimit: number;
  onSave: (formData: FormData) => Promise<ActionResult>;
}) {
  const [active, setActive] = useState(!initial.whatsappPaused);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setMessage(null);
    if (!active) formData.set("whatsapp_paused", "on");
    else formData.delete("whatsapp_paused");
    startTransition(async () => {
      const result = await onSave(formData);
      setMessage(result.ok ? { ok: true, text: "נשמר." } : { ok: false, text: result.error });
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3.5">
      {warmupDay !== null && (
        <div className="rounded-xl px-3.5 py-3" style={{ backgroundColor: "var(--warn-soft)" }}>
          <p className="text-[12.5px] font-semibold text-[var(--warn)]">
            שבוע חימום · יום {warmupDay} מתוך 7
          </p>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <span
                key={i}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  backgroundColor:
                    i < warmupDay
                      ? "var(--warn)"
                      : "color-mix(in srgb, var(--warn) 25%, transparent)",
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--foreground)]">
            היום עד {warmupLimit} הודעות אוטומטיות. התקרה עולה מעצמה בכל יום עד {initial.dailyLimit}.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">שליחה אוטומטית בוואטסאפ</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--subtle)]">
            כיבוי עוצר מיד את הוואטסאפ במסעות, בכללים ובתזכורות. מיילים וניוזלטר לא מושפעים,
            ושליחה ידנית מכרטיס לקוח ממשיכה לעבוד.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label="שליחה אוטומטית בוואטסאפ"
          onClick={() => setActive(!active)}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: active ? "var(--primary)" : "var(--border-strong)" }}
        >
          <span
            className="absolute top-0.5 size-5 rounded-full bg-[var(--knob)] shadow-sm transition-all"
            style={active ? { left: "0.125rem" } : { right: "0.125rem" }}
          />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="field-label">
          תקרה יומית
          <input
            name="daily_limit"
            type="number"
            min={1}
            max={1000}
            required
            defaultValue={initial.dailyLimit}
            className="input"
          />
        </label>
        <fieldset className="field-label">
          <legend className="mb-1">רווח בין הודעות (שניות)</legend>
          <div className="flex items-center gap-1.5">
            <input
              name="min_gap_seconds"
              type="number"
              min={0}
              max={600}
              required
              defaultValue={initial.minGap}
              aria-label="רווח מינימלי בשניות"
              className="input min-w-0"
            />
            <span className="text-[var(--subtle)]">–</span>
            <input
              name="max_gap_seconds"
              type="number"
              min={0}
              max={600}
              required
              defaultValue={initial.maxGap}
              aria-label="רווח מקסימלי בשניות"
              className="input min-w-0"
            />
          </div>
        </fieldset>
      </div>

      <label className="flex items-center gap-2.5 text-[12.5px]">
        <input type="checkbox" name="warmup_enabled" defaultChecked={initial.warmupEnabled} className="cbx" />
        שבוע חימום למספר חדש (התקרה עולה בהדרגה מ-15)
      </label>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3">
        <legend className="px-1 text-[12px] font-medium text-[var(--muted)]">שעות שקטות</legend>
        <label className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <input type="checkbox" name="quiet_hours_enabled" defaultChecked={initial.quietEnabled} className="cbx" />
          בלי וואטסאפ אוטומטי בין
          <select name="quiet_start_hour" defaultValue={initial.quietStart} className="input w-auto py-1" aria-label="תחילת השעות השקטות">
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {pad(h)}:00
              </option>
            ))}
          </select>
          ל-
          <select name="quiet_end_hour" defaultValue={initial.quietEnd} className="input w-auto py-1" aria-label="סוף השעות השקטות">
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {pad(h)}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" name="quiet_shabbat" defaultChecked={initial.quietShabbat} className="cbx" />
          וגם בשבת (שישי 14:00 עד מוצאי שבת 20:00)
        </label>
        <p className="text-[11.5px] leading-relaxed text-[var(--subtle)]">
          הודעות ממסעות וכללים שמגיעות לזמן כזה מחכות ויוצאות כשהוא נגמר. תזכורות אירוע יוצאות
          בזמן שנקבע להן.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "שומר..." : "שמירה"}
        </button>
        {message && (
          <span
            className="text-[12.5px]"
            style={{ color: message.ok ? "var(--ok)" : "var(--danger)" }}
          >
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
