"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { StatusPicker, type StatusOption, type SetStatusResult } from "@/components/status-picker";
import { Avatar } from "@/components/avatar";
import { statusLabel } from "@/lib/status-colors";
import type { FieldInputType } from "@/lib/supabase/database.types";

export interface TableColumn {
  key: string;
  label: string;
  /** קובע איך התא נקרא: נתון LTR באות מונו, תגיות כשבבים, שאר כטקסט. */
  type: FieldInputType;
}

/** נתון שנקרא משמאל לימין חייב אות מונו, אחרת הספרות נשברות בתוך שורה עברית. */
const LTR_TYPES = new Set<FieldInputType>(["phone", "email", "url", "date", "number"]);

export interface TableRow {
  id: string;
  status: string;
  /** ערך מוכן לתצוגה לכל עמודה, לפי אותו סדר של columns */
  cells: (string | null)[];
}

type BulkResult = { ok: true; affected: number } | { ok: false; error: string };

/**
 * טבלת אנשי הקשר. הפכה ל-client component כי היא מחזיקה שני דברים שדורשים
 * מצב בדפדפן: בחירה מרובה ותפריט הסטטוס. הערכים עצמם מחושבים בשרת
 * (readFieldValue) ומגיעים לכאן כמחרוזות מוכנות — כדי שלוגיקת השדות תישאר
 * במקום אחד ולא תשוכפל לצד הלקוח.
 */
export function ContactsTable({
  columns,
  rows,
  statusOptions,
  onSetStatus,
  onBulkDelete,
  onBulkSetStatus,
  onBulkAddTag,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  statusOptions: StatusOption[];
  onSetStatus: (contactId: string, status: string) => Promise<SetStatusResult>;
  onBulkDelete: (ids: string[]) => Promise<BulkResult>;
  onBulkSetStatus: (ids: string[], status: string) => Promise<BulkResult>;
  onBulkAddTag: (ids: string[], tag: string) => Promise<BulkResult>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tag, setTag] = useState("");
  const [pending, startTransition] = useTransition();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmingDelete(false);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(ids));
    setConfirmingDelete(false);
  }

  function run(action: () => Promise<BulkResult>, verb: string, clearSelection: boolean) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: `${verb} ${result.affected} אנשי קשר` });
      setConfirmingDelete(false);
      if (clearSelection) setSelected(new Set());
    });
  }

  const selectedIds = [...selected];

  return (
    <div className="flex flex-col gap-3">
      {message && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "bg-[var(--ok-soft)] text-[var(--ok)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* overflow-hidden על המסגרת, וגלילה על העוטף הפנימי בלבד: אחרת סרגל
          הפעולות והתחתית היו נגללים לצדדים יחד עם הטבלה. */}
      <div className="table-wrap overflow-hidden">
        {someSelected && (
          <div className="bulk-bar">
            <span className="font-semibold text-[var(--primary)]">נבחרו {selected.size}</span>

          <button type="button" className="btn-ghost" onClick={() => setSelected(new Set())}>
            ביטול בחירה
          </button>

          <span className="h-4 w-px bg-[var(--border-strong)]" />

          <label className="flex items-center gap-2">
            שינוי סטטוס ל
            <select
              className="input py-1"
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                const value = e.target.value;
                e.target.value = "";
                if (value) run(() => onBulkSetStatus(selectedIds, value), "עודכנו", false);
              }}
            >
              <option value="">בחרו…</option>
              {statusOptions.map((s) => (
                <option key={s.name} value={s.name}>
                  {statusLabel(s.name)}
                </option>
              ))}
            </select>
          </label>

          <span className="flex items-center gap-2">
            <input
              className="input w-32 py-1"
              placeholder="תגית"
              value={tag}
              disabled={pending}
              onChange={(e) => setTag(e.target.value)}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={pending || !tag.trim()}
              onClick={() =>
                run(() => onBulkAddTag(selectedIds, tag), "תויגו", false)
              }
            >
              הוסף תגית
            </button>
          </span>

          <span className="flex-1" />

          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-[var(--danger)]">למחוק {selected.size} אנשי קשר לצמיתות?</span>
              <button
                type="button"
                className="btn-danger font-semibold"
                disabled={pending}
                onClick={() => run(() => onBulkDelete(selectedIds), "נמחקו", true)}
              >
                כן, למחוק
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmingDelete(false)}>
                ביטול
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="btn-danger"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              מחיקה
            </button>
          )}
          </div>
        )}

        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[var(--border)]">
            <tr>
              <th className="th w-10">
                <input
                  type="checkbox"
                  className="cbx"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="בחירת הכל"
                />
              </th>
              {columns.map((col) => (
                <th key={col.key} className="th">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`tr-hover transition-colors duration-150 ${
                  selected.has(row.id) ? "bg-[var(--primary-soft)]" : ""
                }`}
              >
                <td className="td">
                  <input
                    type="checkbox"
                    className="cbx"
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                    aria-label="בחירת איש קשר"
                  />
                </td>
                {columns.map((col, i) => {
                  const value = row.cells[i];
                  const ltr = LTR_TYPES.has(col.type);
                  return (
                    <td
                      key={col.key}
                      className={`td ${col.key === "full_name" ? "" : "text-[var(--muted)]"}`}
                    >
                      {col.key === "status" ? (
                        <StatusPicker
                          contactId={row.id}
                          status={row.status}
                          options={statusOptions}
                          onSelect={onSetStatus}
                        />
                      ) : col.key === "full_name" ? (
                        <span className="avc">
                          <Avatar name={value || "?"} />
                          <Link
                            href={`/contacts/${row.id}`}
                            className="font-medium text-[var(--foreground)] hover:text-[var(--primary)]"
                          >
                            {value ?? "—"}
                          </Link>
                        </span>
                      ) : col.key === "tags" && value ? (
                        // התגיות מגיעות כמחרוזת מופרדת בפסיקים; כשבבים נפרדים
                        // אפשר לסרוק בעין איזו תגית חוזרת על פני כמה שורות.
                        <span className="inline-flex flex-wrap gap-1">
                          {value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean)
                            .map((t) => (
                              <span key={t} className="tag">
                                {t}
                              </span>
                            ))}
                        </span>
                      ) : ltr && value ? (
                        <span className="data" dir="ltr">
                          {value}
                        </span>
                      ) : (
                        (value ?? "—")
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-12 text-center text-sm text-[var(--subtle)]"
                >
                  אין אנשי קשר להצגה
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        <div className="tbl-foot">
          <span>
            {rows.length === 1 ? "רשומה אחת" : `${rows.length.toLocaleString("he-IL")} רשומות`}
            {someSelected && ` · ${selected.size} מסומנות`}
          </span>
          <span className="flex-1" />
          <span>סימון שורות פותח פעולות מרוכזות בראש הטבלה</span>
        </div>
      </div>
    </div>
  );
}
