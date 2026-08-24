"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { statusColorClasses, statusLabel } from "@/lib/status-colors";

export interface StatusOption {
  name: string;
  color: string;
}

export type SetStatusResult = { ok: true } | { ok: false; error: string };

/**
 * תגית סטטוס שהיא גם כפתור: לחיצה פותחת רשימה, בחירה מעדכנת מיד.
 *
 * התפריט ממוקם ב-position: fixed לפי ה-rect של הכפתור ולא absolute, כי
 * הטבלה יושבת בתוך .table-wrap עם overflow-x-auto — תפריט absolute היה
 * נחתך בגלילה אופקית. המחיר: fixed לא נגרר עם הגלילה, ולכן כל scroll/resize
 * סוגר את התפריט.
 *
 * ה-Server Action מוחזר ולא נזרק (‎{ ok: false, error }‎) בכוונה: כישלון
 * עדכון של שורה אחת לא אמור להפיל את כל עמוד אנשי הקשר ל-error.tsx.
 */
export function StatusPicker({
  contactId,
  status,
  options,
  onSelect,
}: {
  contactId: string;
  status: string;
  options: StatusOption[];
  onSelect: (contactId: string, status: string) => Promise<SetStatusResult>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentColor = options.find((o) => o.name === status)?.color;

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
    buttonRef.current?.focus();
  }, []);

  function openMenu() {
    setError(null);
    setActiveIndex(Math.max(0, options.findIndex((o) => o.name === status)));
    setOpen(true);
  }

  // מיקום נמדד אחרי שהתפריט קיים ב-DOM אבל לפני הציור, כדי שלא יהבהב במקום
  // הלא נכון. אם אין מקום מתחת לכפתור — נפתח מעליו.
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    const rect = button.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
    const margin = 8;

    const openUpwards =
      rect.bottom + menuHeight + margin > window.innerHeight && rect.top - menuHeight - margin > 0;

    setPos({
      top: openUpwards ? rect.top - menuHeight - 6 : rect.bottom + 6,
      left: Math.min(Math.max(margin, rect.left), window.innerWidth - menuWidth - margin),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
      setPos(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }
    function onReflow() {
      setOpen(false);
      setPos(null);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // capture=true כדי לתפוס גם גלילה של .table-wrap עצמו, שלא עולה ל-window
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open, close]);

  function select(name: string) {
    close();
    if (name === status) return;
    setError(null);
    startTransition(async () => {
      const result = await onSelect(contactId, name);
      if (!result.ok) setError(result.error);
    });
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) select(option.name);
    } else if (event.key === "Tab") {
      close();
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : openMenu())}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="לחצו כדי לשנות סטטוס"
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
          transition-[opacity,box-shadow] duration-150 outline-none
          hover:brightness-[0.97] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1
          disabled:opacity-50 ${statusColorClasses(currentColor)}`}
      >
        <span className="whitespace-nowrap">{statusLabel(status)}</span>
        <span aria-hidden className={`text-[8px] leading-none opacity-60 ${open ? "rotate-180" : ""} transition-transform duration-150`}>
          ▼
        </span>
      </button>

      {error && <span className="text-[11px] text-[var(--danger)]">{error}</span>}

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          autoFocus
          onKeyDown={onMenuKeyDown}
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
          }}
          className="z-50 flex max-h-72 min-w-[11rem] flex-col gap-0.5 overflow-y-auto rounded-xl border border-[var(--border)]
            bg-white p-1.5 shadow-[0_8px_24px_rgba(28,26,23,0.12)] outline-none"
        >
          {options.map((option, index) => (
            <button
              key={option.name}
              type="button"
              role="option"
              aria-selected={option.name === status}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(option.name)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm transition-colors duration-100
                ${index === activeIndex ? "bg-[var(--background)]" : ""}`}
            >
              <span className={`size-2.5 shrink-0 rounded-full ${statusColorClasses(option.color)}`} />
              <span className="flex-1">{statusLabel(option.name)}</span>
              {option.name === status && <span className="text-xs text-[var(--primary)]">✓</span>}
            </button>
          ))}
          {!options.length && (
            <p className="px-2 py-1.5 text-sm text-[var(--subtle)]">אין סטטוסים מוגדרים</p>
          )}
        </div>
      )}
    </div>
  );
}
