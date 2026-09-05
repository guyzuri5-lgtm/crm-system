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

/**
 * כמה שורות בעמוד.
 *
 * עד עכשיו לא היה עימוד כלל, והעמוד רינדר את *כל* אנשי הקשר בבת אחת. ב-724
 * רשומות זה כבר 1.2 מגה-בייט של HTML ו-14,533 אלמנטים בעמוד אחד, וזה גדל
 * ליניארית בלי גבול — כל ייבוא אקסל מוסיף לזה. מאה שורות הן יותר ממה שמישהו
 * סורק בעין, ומשאירות את הדף מהיר גם אחרי שהרשימה תוכפל.
 *
 * הסינון והחיפוש רצים במסד ולא על העמוד הנוכחי, ולכן חיפוש עדיין מוצא אדם
 * שיושב ברשומה ה-700.
 */
const PAGE_SIZE = 100;

export default async function ContactsPage(props: PageProps<"/contacts">) {
  await verifyTeamMember();

  const [statuses, columns] = await Promise.all([listStatuses(), tableFields()]);
  const statusNames = new Set(statuses.map((s) => s.name));

  const searchParams = await props.searchParams;
  const statusParam = searchParams.status;
  const qParam = searchParams.q;
  const status = typeof statusParam === "string" && statusNames.has(statusParam) ? statusParam : "";
  const q = typeof qParam === "string" ? qParam : "";

  // עמוד לא תקין (אות, מספר שלילי, אפס) נופל ל-1 ולא למסך שגיאה — זו כתובת
  // שמישהו עלול לערוך ביד או לשמור במועדפים.
  const pageParam = searchParams.page;
  const parsedPage = Number(typeof pageParam === "string" ? pageParam : 1);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabaseAdmin()
    .from("contacts")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (status) query = query.eq("status", status);
  if (q) {
    const escaped = q.replace(/[%_,]/g, (c) => `\\${c}`);
    query = query.or(
      `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`
    );
  }

  const { data: contacts, error, count } = await query;

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * כתובת לעמוד אחר, עם החיפוש והסינון הנוכחיים.
   *
   * טופס הסינון שולח רק q ו-status, ולכן חיפוש חדש מאפס את העמוד מעצמו — וזה
   * הנכון: אחרי סינון, "עמוד 4" של הרשימה הקודמת כבר לא אומר כלום.
   */
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  };

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
      // שדה מסוג date הוא "2026-09-04" — יום בלוח שנה שנקרא כחצות UTC, ולא
      // רגע בזמן. פירוש שלו בשעון אחר מזיז אותו ביום.
      return field.input_type === "date"
        ? new Date(value).toLocaleDateString("he-IL", { timeZone: "UTC" })
        : value;
    }),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="h-page">
        <div>
          <h1>כל אנשי הקשר</h1>
          <p>
            כל מי שנמצא במערכת, כולל מי שיובא מאקסל ומעולם לא כתב. סימון שורות פותח פעולות
            מרוכזות בראש הטבלה.
          </p>
        </div>
        <span className="flex-1" />
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

      <form className="flex flex-wrap items-end gap-2.5 text-sm">
        <label className="field-label">
          חיפוש
          <input
            name="q"
            defaultValue={q}
            placeholder="שם, טלפון או מייל"
            className="input min-w-[15rem]"
          />
        </label>
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
        columns={columns.map((f) => ({ key: f.key, label: f.label, type: f.input_type }))}
        rows={rows}
        total={total}
        offset={offset}
        statusOptions={pickerOptions}
        onSetStatus={setContactStatusAction}
        onBulkDelete={bulkDeleteContactsAction}
        onBulkSetStatus={bulkSetStatusAction}
        onBulkAddTag={bulkAddTagAction}
      />

      {/*
        העימוד מוצג רק כשיש יותר מעמוד אחד. קישורים ולא כפתורים: זו ניווט,
        והוא צריך לעבוד עם פתיחה בלשונית חדשה, עם כפתור "אחורה" ועם שמירה
        במועדפים — שלושת אלה נשברים בכפתור שמריץ JavaScript.
      */}
      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-2 text-sm" aria-label="עימוד">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="btn-secondary" rel="prev">
              הקודם
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40" aria-hidden="true">
              הקודם
            </span>
          )}

          <span className="px-2 text-[var(--muted)]">
            עמוד {page.toLocaleString("he-IL")} מתוך {pageCount.toLocaleString("he-IL")}
          </span>

          {page < pageCount ? (
            <Link href={pageHref(page + 1)} className="btn-secondary" rel="next">
              הבא
            </Link>
          ) : (
            <span className="btn-secondary pointer-events-none opacity-40" aria-hidden="true">
              הבא
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
