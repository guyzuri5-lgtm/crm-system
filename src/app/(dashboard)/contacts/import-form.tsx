"use client";

import { useActionState, useRef, useState } from "react";
import {
  previewImportAction,
  importContactsAction,
  type PreviewState,
  type ImportState,
} from "./actions";

const ACCEPT =
  ".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SKIP = "";

/**
 * ייבוא בשני שלבים: קודם רואים מה יש בקובץ ומאשרים לאן כל עמודה הולכת,
 * ורק אז מייבאים. הקובץ נשמר ב-state של הקומפוננטה ונשלח פעמיים — פעם
 * לתצוגה מקדימה ופעם לייבוא — כדי שלא יהיה מצב שרת זמני בין השלבים.
 */
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);

  const [preview, previewAction, previewPending] = useActionState<PreviewState, FormData>(
    previewImportAction,
    null
  );
  const [result, importAction, importPending] = useActionState<ImportState, FormData>(
    importContactsAction,
    null
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ההצעה האוטומטית היא נקודת הפתיחה של המיפוי הידני, לא החלטה סופית.
  // ההשמה נעשית תוך כדי רינדור ולא ב-useEffect: זה הדפוס שReact ממליץ עליו
  // ל"התאמת state כשה-props משתנים", והוא נמנע מרינדור מיותר עם מיפוי ריק
  // שהמשתמש היה מספיק לראות מהבהב.
  const [syncedPreview, setSyncedPreview] = useState<PreviewState>(null);
  if (preview !== syncedPreview) {
    setSyncedPreview(preview);
    setMapping(preview?.ok ? preview.suggestion.map((s) => s ?? SKIP) : []);
  }

  function reset() {
    setFile(null);
    setMapping([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.location.reload();
  }

  // ── אחרי ייבוא: סיכום ───────────────────────────────────────────────
  if (result?.ok) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Stat label="נוצרו" value={result.created} tone="good" />
          <Stat label="עודכנו" value={result.updated} tone="info" />
          <Stat label="דולגו" value={result.skipped} tone={result.skipped ? "warn" : "muted"} />
        </div>

        {result.unknownStatuses.length > 0 && (
          <p className="text-[var(--muted)]">
            סטטוסים שלא קיימים במערכת ולכן לא הוחלו:{" "}
            <span className="font-medium text-[var(--foreground)]">
              {result.unknownStatuses.join(", ")}
            </span>
            . אנשי הקשר האלה קיבלו את סטטוס ברירת המחדל
            {result.defaultStatusName ? ` (${result.defaultStatusName.replaceAll("_", " ")})` : ""}.
          </p>
        )}

        {result.issues.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[var(--muted)]">
              פירוט {result.issues.length} השורות שדולגו
            </summary>
            <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-xs text-[var(--muted)]">
              {result.issues.map((issue) => (
                <li key={issue.rowNumber}>
                  <span className="font-medium text-[var(--foreground)]">שורה {issue.rowNumber}</span>{" "}
                  — {issue.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        <button type="button" className="btn-secondary self-start" onClick={reset}>
          ייבוא קובץ נוסף
        </button>
      </div>
    );
  }

  // ── שלב 2: מיפוי עמודות ─────────────────────────────────────────────
  if (preview?.ok && file) {
    const mapped = mapping.filter((m) => m !== SKIP);
    const duplicates = mapped.filter((m, i) => mapped.indexOf(m) !== i);
    const identifying = ["full_name", "first_name", "last_name", "phone", "email"];
    const hasIdentity = mapped.some((m) => identifying.includes(m));

    return (
      <form
        action={(formData) => {
          formData.set("file", file);
          formData.set("mapping", JSON.stringify(mapping.map((m) => m || null)));
          return importAction(formData);
        }}
        className="flex flex-col gap-4 text-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[var(--muted)]">
            נמצאו <span className="font-medium text-[var(--foreground)]">{preview.dataRowCount}</span>{" "}
            שורות ב־<span className="font-medium text-[var(--foreground)]">{file.name}</span>. בחרו
            לאן כל עמודה הולכת:
          </p>
          <button type="button" className="btn-ghost" onClick={reset}>
            בחירת קובץ אחר
          </button>
        </div>

        <div className="table-wrap">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-[var(--border)]">
              <tr>
                <th className="th">עמודה בקובץ</th>
                <th className="th">דוגמאות</th>
                <th className="th w-56">שדה ב-CRM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {preview.headers.map((header, i) => {
                const samples = preview.sample
                  .map((row) => row[i])
                  .filter((v) => v && v.trim() !== "")
                  .slice(0, 3);
                return (
                  <tr key={i} className={mapping[i] === SKIP ? "opacity-60" : ""}>
                    <td className="td font-medium">{header || <em>עמודה ללא כותרת</em>}</td>
                    <td className="td text-[var(--muted)]">
                      {samples.length ? (
                        <span className="line-clamp-2">{samples.join(" · ")}</span>
                      ) : (
                        <span className="text-[var(--subtle)]">ריק</span>
                      )}
                    </td>
                    <td className="td">
                      <select
                        className="input w-full py-1.5"
                        value={mapping[i] ?? SKIP}
                        onChange={(e) => {
                          const next = [...mapping];
                          next[i] = e.target.value;
                          setMapping(next);
                        }}
                      >
                        <option value={SKIP}>— לא לייבא —</option>
                        {preview.targets.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!hasIdentity && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            צריך למפות לפחות עמודה אחת לשם, לטלפון או למייל — בלי פרט מזהה אי אפשר ליצור איש קשר.
          </p>
        )}

        {duplicates.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            יותר מעמודה אחת ממופה לאותו שדה. בכל שורה תילקח הערך הראשון שאינו ריק.
          </p>
        )}

        {result && !result.ok && (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger)]">
            {result.error}
          </p>
        )}

        <p className="text-xs text-[var(--subtle)]">
          מי שכבר קיים לפי טלפון או מייל יעודכן ולא יוכפל. ייבוא לא מפעיל כללי אוטומציה — לא יישלחו
          הודעות לאנשים שבקובץ.
        </p>

        <button
          type="submit"
          className="btn-primary self-start"
          disabled={importPending || !hasIdentity}
        >
          {importPending ? "מייבא..." : `ייבא ${preview.dataRowCount} שורות`}
        </button>
      </form>
    );
  }

  // ── שלב 1: בחירת קובץ ───────────────────────────────────────────────
  return (
    <form action={previewAction} className="flex flex-col gap-4 text-sm">
      <p className="text-[var(--muted)]">
        קובץ CSV או XLSX עם שורת כותרות. אחרי הבחירה תראו את העמודות שנמצאו ותוכלו לקשר כל אחת
        לשדה במערכת — כולל שדות שהגדרתם בעצמכם.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          בחירת קובץ
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept={ACCEPT}
            required
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <span className="text-[var(--muted)]">{file?.name ?? "לא נבחר קובץ"}</span>
        <button type="submit" className="btn-primary" disabled={previewPending || !file}>
          {previewPending ? "קורא..." : "המשך למיפוי"}
        </button>
      </div>

      {preview && !preview.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger)]">
          {preview.error}
        </p>
      )}
    </form>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "info" | "warn" | "muted";
}) {
  const tones = {
    good: "bg-emerald-50 text-emerald-700",
    info: "bg-blue-50 text-blue-700",
    warn: "bg-amber-50 text-amber-700",
    muted: "bg-stone-100 text-stone-500",
  } as const;
  return (
    <span className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tones[tone]}`}>
      {label}: {value}
    </span>
  );
}
