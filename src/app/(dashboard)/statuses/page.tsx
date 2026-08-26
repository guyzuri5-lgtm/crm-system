import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import {
  STATUS_COLORS,
  STATUS_COLOR_LABELS,
  statusColorClasses,
  statusLabel,
} from "@/lib/status-colors";
import {
  createStatusAction,
  updateStatusAction,
  deleteStatusAction,
  moveStatusAction,
} from "./actions";

export default async function StatusesPage() {
  await verifyTeamMember();

  const statuses = await listStatuses();
  const db = supabaseAdmin();

  // ספירה לכל סטטוס בנפרד עם head:true — מחזיר רק count, בלי לשלוף שורות.
  // מספר הסטטוסים קטן, אז זה זול יותר משליפת כל אנשי הקשר וספירה בזיכרון.
  const counts = await Promise.all(
    statuses.map(async (status) => {
      const { count } = await db
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("status", status.name);
      return [status.id, count ?? 0] as const;
    })
  );
  const countById = new Map(counts);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">סטטוסים</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          הסטטוס הראשון ברשימה הוא ברירת המחדל לכל ליד חדש שנכנס מוואטסאפ או מהשאלון.
        </p>
      </div>

      <section className="card">
        <h2 className="mb-4 font-medium">סטטוס חדש</h2>
        <form action={createStatusAction} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="field-label flex-1 min-w-[12rem]">
            שם
            <input name="name" required maxLength={40} className="input" placeholder="לדוגמה: ממתין לתשלום" />
          </label>
          <label className="field-label">
            צבע
            <select name="color" className="input" defaultValue="sky">
              {STATUS_COLORS.map((color) => (
                <option key={color} value={color}>
                  {STATUS_COLOR_LABELS[color]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary">
            הוסף סטטוס
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        {statuses.map((status, index) => {
          const inUse = countById.get(status.id) ?? 0;
          const others = statuses.filter((s) => s.id !== status.id);
          return (
            <div key={status.id} className="card flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColorClasses(status.color)}`}
                  >
                    {statusLabel(status.name)}
                  </span>
                  <span className="text-sm text-[var(--muted)]">
                    {inUse} אנשי קשר
                    {index === 0 && " · ברירת מחדל"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <form action={moveStatusAction}>
                    <input type="hidden" name="id" value={status.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      className="btn-ghost"
                      disabled={index === 0}
                      title="הזז למעלה"
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveStatusAction}>
                    <input type="hidden" name="id" value={status.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      className="btn-ghost"
                      disabled={index === statuses.length - 1}
                      title="הזז למטה"
                    >
                      ↓
                    </button>
                  </form>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-4 lg:grid-cols-2">
                <form action={updateStatusAction} className="flex flex-wrap items-end gap-2 text-sm">
                  <input type="hidden" name="id" value={status.id} />
                  <label className="field-label flex-1 min-w-[9rem]">
                    שם
                    <input
                      name="name"
                      defaultValue={status.name}
                      required
                      maxLength={40}
                      className="input"
                    />
                  </label>
                  <label className="field-label">
                    צבע
                    <select name="color" defaultValue={status.color} className="input">
                      {STATUS_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {STATUS_COLOR_LABELS[color]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="btn-secondary">
                    שמור
                  </button>
                </form>

                <form action={deleteStatusAction} className="flex flex-wrap items-end gap-2 text-sm">
                  <input type="hidden" name="id" value={status.id} />
                  {inUse > 0 && (
                    <label className="field-label flex-1 min-w-[9rem]">
                      העברת {inUse} אנשי הקשר ל
                      <select name="move_to" required className="input" defaultValue={others[0]?.id ?? ""}>
                        {others.map((s) => (
                          <option key={s.id} value={s.id}>
                            {statusLabel(s.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="submit"
                    className="btn-danger"
                    disabled={statuses.length === 1 || (inUse > 0 && others.length === 0)}
                  >
                    מחיקת הסטטוס
                  </button>
                </form>
              </div>
            </div>
          );
        })}

        {!statuses.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">
            אין סטטוסים מוגדרים — הוסיפו אחד למעלה. עד אז לא ניתן ליצור אנשי קשר חדשים.
          </p>
        )}
      </section>

      <p className="text-xs text-[var(--subtle)]">
        שינוי שם סטטוס מתעדכן אוטומטית אצל כל אנשי הקשר ובכללי האוטומציה. מחיקה מעבירה
        את אנשי הקשר לסטטוס שתבחרו, ומכבה כלל אוטומציה שנשאר בלי סטטוס יעד. שינויי סטטוס
        קבוצתיים כאלה לא מפעילים כללי אוטומציה ולא שולחים הודעות.
      </p>
    </div>
  );
}
