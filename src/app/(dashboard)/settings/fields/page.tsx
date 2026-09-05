import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listFields } from "@/lib/fields";
import { FIELD_INPUT_TYPES, type FieldInputType } from "@/lib/supabase/database.types";
import {
  createFieldAction,
  updateFieldAction,
  deleteFieldAction,
  moveFieldAction,
} from "./actions";

const TYPE_LABELS: Record<FieldInputType, string> = {
  text: "טקסט",
  longtext: "טקסט ארוך",
  number: "מספר",
  date: "תאריך",
  email: "מייל",
  phone: "טלפון",
  url: "קישור",
};

export default async function FieldsPage() {
  await verifyTeamMember();

  const fields = await listFields();
  const db = supabaseAdmin();

  // כמה אנשי קשר באמת מילאו כל שדה מותאם — כדי שמחיקה תדע להגיד מה נמחק.
  const { data: contacts } = await db.from("contacts").select("custom");
  const usage = new Map<string, number>();
  for (const c of contacts ?? []) {
    for (const key of Object.keys(c.custom ?? {})) {
      if (c.custom[key] !== "" && c.custom[key] != null) {
        usage.set(key, (usage.get(key) ?? 0) + 1);
      }
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="page-title">שדות אנשי קשר</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          הסדר כאן קובע את סדר העמודות בטבלת אנשי הקשר ואת סדר השדות בכרטיס.
        </p>
      </div>

      <section className="card">
        <h2 className="mb-4 font-medium">שדה חדש</h2>
        <form action={createFieldAction} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="field-label flex-1 min-w-[12rem]">
            שם השדה
            <input name="label" required maxLength={40} className="input" placeholder="לדוגמה: עיר" />
          </label>
          <label className="field-label">
            סוג
            <select name="input_type" className="input" defaultValue="text">
              {FIELD_INPUT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="show_in_table" defaultChecked className="size-4" />
            להציג בטבלה
          </label>
          <button type="submit" className="btn-primary">
            הוסף שדה
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const filled = usage.get(field.key) ?? 0;
          return (
            <div key={field.id} className="card flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{field.label}</span>
                  <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--muted)]">
                    {TYPE_LABELS[field.input_type]}
                  </span>
                  {field.kind === "builtin" ? (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                      מובנה
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">
                      {filled} אנשי קשר עם ערך
                    </span>
                  )}
                  {!field.show_in_table && (
                    <span className="text-xs text-[var(--subtle)]">מוסתר מהטבלה</span>
                  )}
                  {!field.editable && (
                    <span className="text-xs text-[var(--subtle)]">לקריאה בלבד</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <form action={moveFieldAction}>
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" className="btn-ghost" disabled={index === 0} title="למעלה">
                      ↑
                    </button>
                  </form>
                  <form action={moveFieldAction}>
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      className="btn-ghost"
                      disabled={index === fields.length - 1}
                      title="למטה"
                    >
                      ↓
                    </button>
                  </form>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-4 text-sm">
                <form action={updateFieldAction} className="flex flex-1 flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={field.id} />
                  <label className="field-label flex-1 min-w-[9rem]">
                    שם תצוגה
                    <input name="label" defaultValue={field.label} required maxLength={40} className="input" />
                  </label>
                  {field.kind === "custom" && (
                    <label className="field-label">
                      סוג
                      <select name="input_type" defaultValue={field.input_type} className="input">
                        {FIELD_INPUT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-2 pb-2">
                    <input
                      type="checkbox"
                      name="show_in_table"
                      defaultChecked={field.show_in_table}
                      className="size-4"
                    />
                    בטבלה
                  </label>
                  <button type="submit" className="btn-secondary">
                    שמור
                  </button>
                </form>

                {field.kind === "custom" && (
                  <form action={deleteFieldAction}>
                    <input type="hidden" name="id" value={field.id} />
                    <button type="submit" className="btn-danger">
                      מחיקת השדה{filled > 0 ? ` (ו-${filled} ערכים)` : ""}
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <p className="text-xs text-[var(--subtle)]">
        שדות מובנים (שם, טלפון, מייל, סטטוס, תגיות, מקור, הערות, נוצר) אפשר לשנות להם שם תצוגה,
        לסדר מחדש ולהסתיר מהטבלה — אבל לא למחוק, כי מנוע האוטומציה, ה-webhooks ותבניות ההודעה
        פונים אליהם בשמם. מחיקת שדה מותאם מוחקת גם את הערכים שמולאו בו.
      </p>
    </div>
  );
}
