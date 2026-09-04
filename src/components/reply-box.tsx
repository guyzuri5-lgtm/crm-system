"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { WindowMeter } from "@/components/window-meter";

/**
 * תיבת הכתיבה שיושבת מתחת לשיחה — בדף איש הקשר ובשורה הנפתחת ב"לקוחות
 * פעילים", אותו רכיב בשני המקומות.
 *
 * רכיב לקוח ולא <form action> פשוט, משתי סיבות שקשורות זו בזו: שגיאת שליחה
 * צריכה להופיע ליד התיבה ולא להפיל את העמוד ל-error.tsx (ובפרודקשן הנוסח
 * העברי נבלע בדרך ממילא), ותיבת מענה בשיחה צריכה להתנקות אחרי שליחה מוצלחת
 * ולשלוח ב-Enter. שני הדברים דורשים מצב בדפדפן.
 */

export type ReplyResult = { ok: true } | { ok: false; error: string };

export interface ReplyTemplate {
  id: string;
  name: string;
}

export function ReplyBox({
  contactId,
  canSend,
  openWindow,
  hoursLeft,
  templates,
  onSend,
}: {
  contactId: string;
  canSend: boolean;
  openWindow: boolean;
  hoursLeft: number;
  templates: ReplyTemplate[];
  onSend: (formData: FormData) => Promise<ReplyResult>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await onSend(formData);
      if (result.ok) {
        formRef.current?.reset();
        setSent(true);
      } else {
        setError(result.error);
      }
    });
  }

  if (!canSend) {
    return (
      <p className="rounded-xl bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--muted)]">
        אין לאיש הקשר מספר טלפון, ולא התקבלה ממנו הודעה בוואטסאפ — אין לאן לשלוח.
      </p>
    );
  }

  // מחוץ לחלון 24 השעות אין תבנית מאושרת = אין דרך חוקית לפנות. עדיף לומר
  // את זה מראש מאשר להציג תיבת כתיבה שכל שליחה ממנה תיכשל.
  if (!openWindow && !templates.length) {
    return (
      <p className="rounded-xl bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--muted)]">
        החלון סגור ואין תבנית שאושרה ב-Meta, אז אי אפשר לפנות עכשיו. צרו אחת ב
        <Link href="/templates" className="text-[var(--primary)] underline">
          תבניות הודעה
        </Link>
        .
      </p>
    );
  }

  return (
    <form ref={formRef} action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="contact_id" value={contactId} />

      {openWindow ? (
        <div className="flex items-end gap-2">
          <textarea
            name="body"
            rows={1}
            required
            disabled={pending}
            placeholder="כתבו הודעה..."
            className="input max-h-32 min-h-[42px] flex-1 resize-y"
            onKeyDown={(event) => {
              // Enter שולח, Shift+Enter יורד שורה — ההרגל מכל תוכנת מסרים.
              // תוך כדי הרכבה של תו (IME) Enter שייך למקלדת, לא לשליחה.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={pending} className="btn-primary shrink-0">
            {pending ? "שולח..." : "שלח"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="field-label min-w-48 flex-1">
            תבנית מאושרת
            <select name="template_id" required disabled={pending} className="input">
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "שולח..." : "שלח תבנית"}
          </button>
        </div>
      )}

      {/* המד אומר כמה נשאר, המשפט אומר מה זה אומר. קודם היה רק המשפט, וכדי
          לדעת אם נשאר זמן צריך היה לקרוא אותו עד הסוף. */}
      <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--subtle)]">
        <WindowMeter openWindow={openWindow} hoursLeft={hoursLeft} />
        {openWindow
          ? "טקסט חופשי מותר, ללא עלות."
          : "מותר לשלוח רק תבנית שאושרה ב-Meta, והיא מחויבת."}
      </p>

      {error && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {sent && !error && (
        <p className="text-sm text-[var(--primary)]">ההודעה נשלחה.</p>
      )}
    </form>
  );
}
