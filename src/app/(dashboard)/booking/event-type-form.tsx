import { BOOKING_LOCATIONS, BOOKING_LOCATION_LABELS, type BookingEventType } from "@/lib/supabase/database.types";
import { STATUS_COLORS, STATUS_COLOR_LABELS, statusLabel } from "@/lib/status-colors";
import { createEventTypeAction, updateEventTypeAction } from "./actions";

/**
 * טופס אחד שמשמש גם ליצירה וגם לעריכה — ההבדל היחיד הוא ה-action ושדה ה-id
 * הנסתר. שכפול הטופס לשתי גרסאות היה מבטיח שהן יסטו זו מזו בעדכון הבא.
 */
export function EventTypeForm({
  eventType,
  statuses,
}: {
  eventType?: BookingEventType;
  statuses: string[];
}) {
  const isEdit = Boolean(eventType);

  return (
    <form
      action={isEdit ? updateEventTypeAction : createEventTypeAction}
      className="grid grid-cols-1 gap-4 md:grid-cols-2"
    >
      {eventType && <input type="hidden" name="id" value={eventType.id} />}

      <label className="field-label">
        שם סוג הפגישה
        <input name="name" required defaultValue={eventType?.name} className="input" />
      </label>

      <label className="field-label">
        כתובת הקישור
        <input
          name="slug"
          required
          defaultValue={eventType?.slug}
          className="input"
          dir="ltr"
          placeholder="intro"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          הקישור יהיה /book/<span dir="ltr">{eventType?.slug ?? "..."}</span>
        </span>
      </label>

      <label className="field-label md:col-span-2">
        תיאור שיוצג ללקוח
        <textarea
          name="description"
          rows={2}
          defaultValue={eventType?.description ?? ""}
          className="input"
        />
      </label>

      <label className="field-label">
        משך הפגישה (דקות)
        <input
          name="duration_minutes"
          type="number"
          min={5}
          max={480}
          required
          defaultValue={eventType?.duration_minutes ?? 30}
          className="input"
        />
      </label>

      <label className="field-label">
        כל כמה דקות להציע שעה
        <input
          name="slot_interval_minutes"
          type="number"
          min={5}
          max={120}
          required
          defaultValue={eventType?.slot_interval_minutes ?? 15}
          className="input"
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          15 = השעות המוצעות יהיו 9:00, 9:15, 9:30…
        </span>
      </label>

      <label className="field-label">
        הפסקה בין פגישות (דקות)
        <input
          name="buffer_minutes"
          type="number"
          min={0}
          max={240}
          // שתי עמודות ב-DB, שדה אחד בטופס. מוצג המקסימום שביניהן כדי
          // שסוג פגישה ישן עם ערכים אסימטריים לא ייראה כאילו אין לו הפסקה.
          defaultValue={Math.max(
            eventType?.buffer_before_minutes ?? 0,
            eventType?.buffer_after_minutes ?? 10
          )}
          className="input"
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          מרווח מוגן לפני ואחרי כל פגישה. 15 = אחרי פגישה שנגמרת ב-10:00
          לא תוצע שעה לפני 10:15
        </span>
      </label>

      <label className="field-label">
        התראה מוקדמת מינימלית (שעות)
        <input
          name="min_notice_hours"
          type="number"
          min={0}
          max={720}
          defaultValue={eventType?.min_notice_hours ?? 4}
          className="input"
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          כמה זמן מראש חייבים לקבוע
        </span>
      </label>

      <label className="field-label">
        עד כמה ימים קדימה
        <input
          name="max_days_ahead"
          type="number"
          min={1}
          max={365}
          defaultValue={eventType?.max_days_ahead ?? 30}
          className="input"
        />
      </label>

      <label className="field-label">
        איפה נפגשים
        <select name="location" defaultValue={eventType?.location ?? "google_meet"} className="input">
          {BOOKING_LOCATIONS.map((location) => (
            <option key={location} value={location}>
              {BOOKING_LOCATION_LABELS[location]}
            </option>
          ))}
        </select>
      </label>

      <label className="field-label">
        פרטי מקום (לטלפון או פגישה פרונטלית)
        <input
          name="location_details"
          defaultValue={eventType?.location_details ?? ""}
          className="input"
          placeholder="כתובת, או מספר טלפון להתקשר אליו"
        />
      </label>

      <label className="field-label">
        צבע
        <select name="color" defaultValue={eventType?.color ?? "blue"} className="input">
          {STATUS_COLORS.map((color) => (
            <option key={color} value={color}>
              {STATUS_COLOR_LABELS[color]}
            </option>
          ))}
        </select>
      </label>

      <label className="field-label">
        להעביר את הליד לסטטוס
        <select
          name="set_contact_status"
          defaultValue={eventType?.set_contact_status ?? ""}
          className="input"
        >
          <option value="">לא לשנות סטטוס</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 self-end text-sm font-medium md:col-span-2">
        <input
          type="checkbox"
          name="active"
          defaultChecked={eventType?.active ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        פעיל — הקישור עובד ואפשר לקבוע דרכו
      </label>

      <button type="submit" className="btn-primary self-start md:col-span-2">
        {isEdit ? "שמירת שינויים" : "יצירת סוג פגישה"}
      </button>
    </form>
  );
}
