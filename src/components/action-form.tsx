"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";

/**
 * טופס שמציג את שגיאת הפעולה שלו במקום להפיל את העמוד.
 *
 * מחליף `<form action={someAction}>` אחד-לאחד: אותם ילדים, אותו className.
 * ההבדל היחיד הוא שהפעולה מחזירה תוצאה, ואם היא נכשלה הנוסח מופיע מתחת
 * לטופס — ולא כמסך שגיאה גנרי של React שאינו מסביר דבר.
 *
 * fieldset עם display:contents ולא div: הוא מנטרל את כל הפקדים שבתוכו בזמן
 * הריצה (וזה מה שמונע לחיצה כפולה על "מחק"), אבל אינו קיים לצורכי פריסה —
 * כך שטופס flex נשאר flex ושורת הכפתורים לא זזה.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  /** לטפסי "הוספה" — לנקות את השדות אחרי שהפריט נוסף. */
  resetOnSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result.ok) {
        if (resetOnSuccess) formRef.current?.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>

      {/*
        w-full כדי שבטופס flex-wrap השגיאה תתפוס שורה משלה מתחת לפקדים,
        במקום להידחס ביניהם ולשבור את היישור.
      */}
      {error && (
        <p className="w-full rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}
