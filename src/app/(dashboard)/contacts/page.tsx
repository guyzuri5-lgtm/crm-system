import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { listStatuses } from "@/lib/statuses";
import { statusLabel } from "@/lib/status-colors";
import { StatusPicker } from "@/components/status-picker";
import { createContactAction, setContactStatusAction } from "./actions";
import { ImportForm } from "./import-form";

export default async function ContactsPage(props: PageProps<"/contacts">) {
  await verifyTeamMember();

  const statuses = await listStatuses();
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">אנשי קשר</h1>
        <Link href="/statuses" className="btn-ghost">
          ניהול סטטוסים
        </Link>
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

      <div className="table-wrap">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <th className="th">שם</th>
              <th className="th">טלפון</th>
              <th className="th">מייל</th>
              <th className="th">סטטוס</th>
              <th className="th">תגיות</th>
              <th className="th">מקור</th>
              <th className="th">נוצר</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {contacts?.map((c) => (
              <tr key={c.id} className="tr-hover transition-colors duration-150">
                <td className="td">
                  <Link
                    href={`/contacts/${c.id}`}
                    className="font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                  >
                    {c.full_name ?? "—"}
                  </Link>
                </td>
                <td className="td text-[var(--muted)]">{c.phone ?? "—"}</td>
                <td className="td text-[var(--muted)]">{c.email ?? "—"}</td>
                <td className="td">
                  <StatusPicker
                    contactId={c.id}
                    status={c.status}
                    options={pickerOptions}
                    onSelect={setContactStatusAction}
                  />
                </td>
                <td className="td text-[var(--muted)]">{c.tags.join(", ") || "—"}</td>
                <td className="td text-[var(--muted)]">{c.source}</td>
                <td className="td text-[var(--muted)]">
                  {new Date(c.created_at).toLocaleDateString("he-IL")}
                </td>
              </tr>
            ))}
            {!contacts?.length && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--subtle)]">
                  אין אנשי קשר להצגה
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
