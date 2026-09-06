import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listStatuses } from "@/lib/statuses";
import { tableFields, readFieldValue } from "@/lib/fields";
import { statusLabel } from "@/lib/status-colors";
import { SkelTable, SkelCard } from "@/components/skeleton";
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

type Search = { [key: string]: string | string[] | undefined };

/**
 * גוף עמוד אנשי הקשר — כל מה שתלוי במסד.
 *
 * ── למה הוא הופרד מהעמוד ──
 * העמוד רץ קודם בשלושה גלים בזה אחר זה: אימות, ואז רשימת הסטטוסים והשדות,
 * ורק אז אנשי הקשר. שלוש נסיעות לשרת בטור, כשכל אחת מהן היא רבע שנייה
 * לפחות — ובכל הזמן הזה המסך לא הראה דבר.
 *
 * עכשיו הכותרת מצטיירת מיד, והחלק הזה נכנס בזרם. בתוכו שלוש השאילתות רצות
 * בגל אחד: השאילתה של אנשי הקשר אינה ממתינה עוד לרשימת הסטטוסים.
 */
export async function ContactsWorkspace({ searchParams }: { searchParams: Search }) {
  const statusParam = searchParams.status;
  const qParam = searchParams.q;
  const rawStatus = typeof statusParam === "string" ? statusParam : "";
  const q = typeof qParam === "string" ? qParam : "";

  // עמוד לא תקין (אות, מספר שלילי, אפס) נופל ל-1 ולא למסך שגיאה — זו כתובת
  // שמישהו עלול לערוך ביד או לשמור במועדפים.
  const pageParam = searchParams.page;
  const parsedPage = Number(typeof pageParam === "string" ? pageParam : 1);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  /** השאילתה עצמה, עם או בלי סינון סטטוס. */
  const fetchContacts = (status: string) => {
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
    return query;
  };

  // גל אחד ולא שניים: השאילתה יוצאת עם הסטטוס כפי שהתקבל, במקלביל לשליפת
  // רשימת הסטטוסים שמאמתת אותו. הפרמטר מגיע כמעט תמיד מהתפריט עצמו, ולכן
  // הוא כמעט תמיד תקין — ורק במקרה החריג משלמים על שאילתה שנייה.
  const [statuses, columns, first] = await Promise.all([
    listStatuses(),
    tableFields(),
    fetchContacts(rawStatus),
  ]);

  const statusNames = new Set(statuses.map((s) => s.name));
  const status = rawStatus && statusNames.has(rawStatus) ? rawStatus : "";

  // סטטוס שאינו קיים מתעלמים ממנו ומציגים הכל — כמו קודם. זה קורה רק
  // בכתובת שנערכה ביד, ואז נשלפת שאילתה נוספת בלי הסינון.
  const { data: contacts, error, count } = status === rawStatus ? first : await fetchContacts("");

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
    <>
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
    </>
  );
}

export function ContactsWorkspaceFallback() {
  return (
    <>
      <SkelCard lines={1} title={false} />
      <SkelCard lines={1} title={false} />
      <SkelTable rows={10} cols={5} />
    </>
  );
}
