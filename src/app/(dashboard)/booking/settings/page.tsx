import { ActionForm } from "@/components/action-form";
import Image from "next/image";
import { verifyTeamMember } from "@/lib/dal";
import { getBookingSettings, listBlackouts } from "@/lib/booking/data";
import { formatDateTime } from "@/lib/booking/timezone";
import {
  addBlackoutAction,
  deleteBlackoutAction,
  removeHostPhotoAction,
  saveSettingsAction,
  uploadHostPhotoAction,
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
              <ActionForm action={deleteBlackoutAction}>
                <input type="hidden" name="id" value={blackout.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </ActionForm>
            </div>
          ))}
          {!blackouts.length && (
            <p className="text-sm text-[var(--subtle)]">אין חסימות פעילות</p>
          )}
        </div>

        <ActionForm
          action={addBlackoutAction}
          resetOnSuccess
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
        </ActionForm>
      </section>

      {/* ── כרטיס המארח בדף ההזמנה ────────────────────────────────── */}
      <section className="card">
        <h2 className="font-medium">התמונה שלך בדף ההזמנה</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          מוצגת ללקוח בראש דף קביעת הפגישה, יחד עם השם והתפקיד שמולאו למטה.
          בלי תמונה הדף נראה בדיוק כפי שנראה עד היום.
        </p>

        <div className="flex flex-wrap items-center gap-5">
          {settings.host_photo_url ? (
            <Image
              src={settings.host_photo_url}
              alt="תמונת המארח"
              width={96}
              height={96}
              // התמונה נחתכת למעגל, ולכן object-cover ולא contain: פרופיל
              // מלבני היה מתכווץ ומשאיר פסים ריקים בתוך העיגול.
              className="size-24 rounded-full object-cover ring-1 ring-[var(--border-strong)]"
            />
          ) : (
            <div className="grid size-24 place-items-center rounded-full bg-[var(--background)] text-xs text-[var(--subtle)] ring-1 ring-[var(--border)]">
              אין תמונה
            </div>
          )}

          <ActionForm action={uploadHostPhotoAction} className="flex flex-wrap items-end gap-3">
            <label className="field-label">
              העלאת תמונה
              <input
                type="file"
                name="photo"
                required
                accept="image/jpeg,image/png,image/webp"
                className="input py-1.5 text-sm file:me-3 file:rounded-md file:border-0 file:bg-[var(--primary-soft)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--primary)]"
              />
              <span className="text-xs font-normal text-[var(--subtle)]">
                JPG, PNG או WEBP, עד 2MB. תמונה מרובעת תיראה הכי טוב.
              </span>
            </label>
            <button type="submit" className="btn-primary">
              שמירת התמונה
            </button>
          </ActionForm>

          {settings.host_photo_url && (
            <ActionForm action={removeHostPhotoAction}>
              <button type="submit" className="btn-danger">
                הסרת התמונה
              </button>
            </ActionForm>
          )}
        </div>
      </section>

      {/* ── הגדרות כלליות ─────────────────────────────────────────── */}
      <section className="card">
        <h2 className="mb-4 font-medium">הגדרות כלליות</h2>
        <ActionForm action={saveSettingsAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            שם שיוצג ללקוח
            <input name="brand_name" defaultValue={settings.brand_name} required className="input" />
          </label>
          <label className="field-label">
            השם שלך
            <input
              name="host_name"
              defaultValue={settings.host_name ?? ""}
              className="input"
              placeholder="גיא צורי"
            />
            <span className="text-xs font-normal text-[var(--subtle)]">
              מוצג ליד התמונה בדף ההזמנה. אפשר להשאיר ריק.
            </span>
          </label>
          <label className="field-label">
            תפקיד או תיאור קצר
            <input
              name="host_title"
              defaultValue={settings.host_title ?? ""}
              className="input"
              placeholder="מלווה תהליכי שחרור חסימות אנרגטיות"
            />
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
          <label className="flex items-start gap-2.5 text-sm font-medium md:col-span-2">
            <input
              type="checkbox"
              name="block_all_day_events"
              defaultChecked={settings.block_all_day_events}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              אירוע &quot;יום שלם&quot; ביומן חוסם את כל היום
              <span className="mt-0.5 block text-xs font-normal text-[var(--subtle)]">
                כבוי כברירת מחדל. ימי הולדת, חגים ותזכורות נשמרים ביומן כאירוע
                יום שלם, ואם הם חוסמים — יום שלם של פגישות נעלם מהקישור. הדליקו
                רק אם אתם מסמנים חופשות בדרך הזו. פגישות רגילות עם שעות חוסמות
                תמיד, בלי קשר להגדרה.
              </span>
            </span>
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-2">
            שמירת הגדרות
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
