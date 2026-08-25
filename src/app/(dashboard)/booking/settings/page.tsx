import { verifyTeamMember } from "@/lib/dal";
import { getBookingSettings, listBlackouts } from "@/lib/booking/data";
import { formatDateTime } from "@/lib/booking/timezone";
import {
  addBlackoutAction,
  deleteBlackoutAction,
  saveSettingsAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function BookingSettingsPage() {
  await verifyTeamMember();

  const [settings, blackouts] = await Promise.all([
    getBookingSettings(),
    // רק חסימות שעוד רלוונטיות — חסימות שעברו הן רעש.
    listBlackouts(new Date()),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {/* ── חסימות ידניות ─────────────────────────────────────────── */}
      <section className="card">
        <h2 className="font-medium">חסימות ידניות</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          חלונות שבהם לא תהיה זמינות, גם אם הם בתוך שעות העבודה — חופשה, נסיעה,
          יום שכולו עמוס.
        </p>

        <div className="flex flex-col gap-2">
          {blackouts.map((blackout) => (
            <div
              key={blackout.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2 text-sm last:border-0"
            >
              <span>
                <span className="font-medium">
                  {formatDateTime(new Date(blackout.starts_at), settings.timezone)}
                </span>
                <span className="text-[var(--muted)]">
                  {" "}
                  עד {formatDateTime(new Date(blackout.ends_at), settings.timezone)}
                </span>
                {blackout.reason && (
                  <span className="block text-xs text-[var(--subtle)]">{blackout.reason}</span>
                )}
              </span>
              <form action={deleteBlackoutAction}>
                <input type="hidden" name="id" value={blackout.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </form>
            </div>
          ))}
          {!blackouts.length && (
            <p className="text-sm text-[var(--subtle)]">אין חסימות פעילות</p>
          )}
        </div>

        <form
          action={addBlackoutAction}
          className="mt-5 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-5"
        >
          <label className="field-label">
            מתי מתחיל
            <input type="datetime-local" name="starts_at" required className="input" />
          </label>
          <label className="field-label">
            מתי נגמר
            <input type="datetime-local" name="ends_at" required className="input" />
          </label>
          <label className="field-label">
            סיבה (לא מוצגת ללקוחות)
            <input name="reason" className="input" placeholder="חופשה" />
          </label>
          <button type="submit" className="btn-primary">
            הוספת חסימה
          </button>
        </form>
      </section>

      {/* ── הגדרות כלליות ─────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-4 font-medium">הגדרות כלליות</h2>
        <form action={saveSettingsAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            שם שיוצג ללקוח
            <input name="brand_name" defaultValue={settings.brand_name} required className="input" />
          </label>
          <label className="field-label">
            אזור זמן
            <input
              name="timezone"
              defaultValue={settings.timezone}
              required
              className="input"
              dir="ltr"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              שם IANA, למשל Asia/Jerusalem. כל שעות הזמינות מנוסחות לפיו.
            </span>
          </label>
          <label className="field-label">
            היומן שאליו נכתבות הפגישות
            <input
              name="calendar_id"
              defaultValue={settings.calendar_id}
              required
              className="input"
              dir="ltr"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              primary = היומן הראשי של החשבון המחובר
            </span>
          </label>
          <label className="field-label">
            יומנים נוספים לבדיקת תפוסה
            <textarea
              name="busy_calendar_ids"
              rows={3}
              defaultValue={settings.busy_calendar_ids.join("\n")}
              className="input"
              dir="ltr"
              placeholder="family@group.calendar.google.com"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              שורה לכל יומן. נלקחים בחשבון כ&quot;תפוס&quot; אבל לא נכתבות אליהם פגישות.
            </span>
          </label>
          <button type="submit" className="btn-primary self-start md:col-span-2">
            שמירת הגדרות
          </button>
        </form>
      </section>
    </div>
  );
}
