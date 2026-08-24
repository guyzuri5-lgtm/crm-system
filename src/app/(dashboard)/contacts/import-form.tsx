"use client";

import { useActionState, useRef, useState } from "react";
import { importContactsAction, type ImportState } from "./actions";

const ACCEPT = ".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function ImportForm() {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    importContactsAction,
    null
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4 text-sm">
      <p className="text-[var(--muted)]">
        קובץ CSV או XLSX עם שורת כותרות. מזוהות אוטומטית העמודות:{" "}
        <span className="font-medium text-[var(--foreground)]">
          שם / שם פרטי + שם משפחה, טלפון, מייל, סטטוס, תגיות, הערות, מקור
        </span>{" "}
        (וגם המקבילות באנגלית). מי שכבר קיים לפי טלפון או מייל — מתעדכן ולא מוכפל.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          בחירת קובץ
          <input
            type="file"
            name="file"
            accept={ACCEPT}
            required
            className="hidden"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <span className="text-[var(--muted)]">{fileName ?? "לא נבחר קובץ"}</span>
        <button type="submit" className="btn-primary" disabled={pending || !fileName}>
          {pending ? "מייבא..." : "ייבא"}
        </button>
      </div>

      <p className="text-xs text-[var(--subtle)]">
        ייבוא לא מפעיל כללי אוטומציה — גם אם הקובץ קובע סטטוס, לא יישלחו הודעות לאנשים שבו.
      </p>

      {state && !state.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger)]">
          {state.error}
        </p>
      )}

      {state?.ok && (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap gap-2">
            <Stat label="נוצרו" value={state.created} tone="good" />
            <Stat label="עודכנו" value={state.updated} tone="info" />
            <Stat label="דולגו" value={state.skipped} tone={state.skipped ? "warn" : "muted"} />
          </div>

          {state.unknownStatuses.length > 0 && (
            <p className="text-[var(--muted)]">
              סטטוסים שלא קיימים במערכת ולכן לא הוחלו:{" "}
              <span className="font-medium text-[var(--foreground)]">
                {state.unknownStatuses.join(", ")}
              </span>
              . אנשי הקשר האלה קיבלו את סטטוס ברירת המחדל
              {state.defaultStatusName ? ` (${state.defaultStatusName.replaceAll("_", " ")})` : ""}.
              אפשר להוסיף אותם בעמוד הסטטוסים ולייבא שוב.
            </p>
          )}

          {state.issues.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[var(--muted)]">
                פירוט {state.issues.length} השורות שדולגו
              </summary>
              <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-xs text-[var(--muted)]">
                {state.issues.map((issue) => (
                  <li key={issue.rowNumber}>
                    <span className="font-medium text-[var(--foreground)]">
                      שורה {issue.rowNumber}
                    </span>{" "}
                    — {issue.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
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
