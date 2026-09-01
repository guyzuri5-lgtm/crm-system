import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import { tableFields, readFieldValue } from "@/lib/fields";
import { statusLabel } from "@/lib/status-colors";
import { ContactsTable, type TableRow } from "./contacts-table";
import {
  createContactAction,
  setContactStatusAction,
  bulkDeleteContactsAction,
  bulkSetStatusAction,
  bulkAddTagAction,
} from "./actions";
import { ImportForm } from "./import-form";

export default async function ContactsPage(props: PageProps<"/contacts">) {
  await verifyTeamMember();

  const [statuses, columns] = await Promise.all([listStatuses(), tableFields()]);
  const statusNames = new Set(statuses.map((s) => s.name));

  const searchParams = await props.searchParams;
  const statusParam = searchParams.status;
  const qParam = searchParams.q;
  const status = typeof statusParam === "string" && statusNames.has(statusParam) ? statusParam : "";
  const q = typeof qParam === "string" ? qParam : "";

  let query = supabaseAdmin()
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (q) {
    const escaped = q.replace(/[%_,]/g, (c) => `\\${c}`);
    query = query.or(
      `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`
    );
  }

  const { data: contacts, error } = await query;

  // האפשרויות ל-StatusPicker נשלחות פעם אחת מהשרת ומשותפות לכל השורות, במקום
  // שכל שורה תשלוף אותן בעצמה.
  const pickerOptions = statuses.map((s) => ({ name: s.name, color: s.color }));

  // הערכים מחושבים כאן ולא בקומפוננטה: readFieldValue יודע לקרוא גם עמודות
  // אמיתיות של contacts וגם שדות מתוך contacts.custom, וזו לוגיקה שאין סיבה
  // לשכפל לצד הלקוח.
  const rows: TableRow[] = (contacts ?? []).map((contact) => ({
    id: contact.id,
    status: contact.status,
    cells: columns.map((field) => {
      const value = readFieldValue(contact, field);
      if (value == null) return null;
      return field.input_type === "date" ? new Date(value).toLocaleDateString("he-IL") : value;
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">אנשי קשר</h1>
        <div className="flex items-center gap-1">
          <Link href="/settings/fields" className="btn-ghost">
            ניהול שדות
          </Link>
          <Link href="/settings/statuses" className="btn-ghost">
            ניהול סטטוסים
          </Link>
        </div>
      </div>

      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <span className="grid size-5 place-items-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)] transition-transform duration-150 group-open:rotate-45">
            +
          </span>
          איש קשר חדש (ידני)
        </summary>
        <form
          action={createContactAction}
          className="mt-4 grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-4 text-sm md:grid-cols-2"
        >
          <label className="field-label">
            שם מלא
            <input name="full_name" required className="input" />
          </label>
          <label className="field-label">
            סטטוס
            <select name="status" defaultValue={statuses[0]?.name ?? ""} className="input">
              {statuses.map((s) => (
                <option key={s.id} value={s.name}>
                  {statusLabel(s.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            טלפון
            <input name="phone" className="input" />
          </label>
          <label className="field-label">
            מייל
            <input name="email" type="email" className="input" />
          </label>
          <label className="field-label md:col-span-2">
            תגיות (מופרדות בפסיק)
            <input name="tags" placeholder="לדוגמה: VIP, פייסבוק" className="input" />
          </label>
          <button type="submit" className="btn-primary self-start md:col-span-2">
            הוסף איש קשר
          </button>
        </form>
      </details>

      <details className="card group">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
          <span className="grid size-5 place-items-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)] transition-transform duration-150 group-open:rotate-45">
            ↑
          </span>
          ייבוא מקובץ אקסל / CSV
        </summary>
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <ImportForm />
        </div>
      </details>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="field-label">
          סטטוס
          <select name="status" defaultValue={status} className="input">
            <option value="">הכל</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.name}>
                {statusLabel(s.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          חיפוש (שם / טלפון / מייל)
          <input name="q" defaultValue={q} className="input" />
        </label>
        <button type="submit" className="btn-secondary">
          סנן
        </button>
        {(status || q) && (
          <Link href="/contacts" className="btn-ghost">
            איפוס
          </Link>
        )}
      </form>

      {error && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error.message}
        </p>
      )}

      <ContactsTable
        columns={columns.map((f) => ({ key: f.key, label: f.label }))}
        rows={rows}
        statusOptions={pickerOptions}
        onSetStatus={setContactStatusAction}
        onBulkDelete={bulkDeleteContactsAction}
        onBulkSetStatus={bulkSetStatusAction}
        onBulkAddTag={bulkAddTagAction}
      />
    </div>
  );
}
