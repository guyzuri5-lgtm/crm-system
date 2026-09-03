"use client";

import { useActionState, useState } from "react";
import { createEventAction, type EventResult } from "../actions";

/**
 * טופס היצירה — שדות הבסיס בלבד. אחרי השמירה הפעולה מעבירה לעורך העיצוב,
 * ושם נקבע איך הדף ייראה.
 *
 * ה-slug מוצע אוטומטית מהשם אבל נשאר בשליטת המשתמש: הוא חלק מהכתובת שתישלח
 * לקהל, ושינוי שלו אחרי שהקישור כבר יצא שובר אותו.
 */
export function NewEventForm() {
  const [state, formAction, pending] = useActionState<EventResult | null, FormData>(
    createEventAction,
    null
  );
  const [slug, setSlug] = useState("");

  return (
    <form action={formAction} className="card grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="field-label md:col-span-2">
        שם האירוע
        <input name="name" required maxLength={160} className="input" placeholder="ערב ריפוי בצלילים" />
      </label>

      <label className="field-label md:col-span-2">
        כתובת הקישור
        <input
          name="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="input"
          dir="ltr"
          placeholder="sound-healing"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={80}
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          דף ההרשמה יהיה בכתובת /event/<span dir="ltr">{slug || "..."}</span> — אותיות אנגליות
          קטנות, ספרות ומקפים.
        </span>
      </label>

      <label className="field-label">
        תאריך
        <input name="date" type="date" required className="input" />
      </label>

      <label className="field-label">
        שעה
        <input name="time" type="time" required className="input" defaultValue="19:00" />
      </label>

      <label className="field-label">
        מיקום
        <input name="location" maxLength={300} className="input" placeholder="סטודיו, רחוב הרצל 5, תל אביב" />
      </label>

      <label className="field-label">
        מספר מקומות
        <input name="capacity" type="number" min={1} max={100000} className="input" />
        <span className="text-xs font-normal text-[var(--subtle)]">ריק = בלי הגבלה</span>
      </label>

      <label className="field-label md:col-span-2">
        לינק התשלום בגרואו
        <input name="grow_link" type="url" maxLength={2000} className="input" dir="ltr" placeholder="https://" />
        <span className="text-xs font-normal text-[var(--subtle)]">
          ריק = הטופס מוביל ישר לעמוד התודה, בלי תשלום.
        </span>
      </label>

      <fieldset className="flex flex-col gap-2 md:col-span-2">
        <span className="text-sm font-medium">תזכורות בוואטסאפ למי ששילמה</span>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remind_day_before" defaultChecked className="size-4" />
          יום לפני האירוע
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="remind_hour_before" defaultChecked className="size-4" />
          שעה לפני האירוע
        </label>
      </fieldset>

      {state && !state.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)] md:col-span-2">
          {state.error}
        </p>
      )}

      <div className="md:col-span-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "שומר…" : "יצירה ומעבר לעיצוב הדף"}
        </button>
      </div>
    </form>
  );
}
