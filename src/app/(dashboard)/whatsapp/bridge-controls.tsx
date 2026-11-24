"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "./actions";

type PairResult = { ok: true; code: string } | { ok: false; error: string };

/** "שלח הודעת בדיקה לעצמי" — ההוכחה הכי פשוטה שהגשר באמת שולח. */
export function TestToSelfButton({ onSend }: { onSend: () => Promise<ActionResult> }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className="btn-secondary"
        onClick={() =>
          startTransition(async () => {
            const result = await onSend();
            setMessage(
              result.ok
                ? { ok: true, text: "נשלחה. תבדוק את הצ'אט \"הודעה לעצמי\" בטלפון." }
                : { ok: false, text: result.error }
            );
          })
        }
      >
        {pending ? "שולח..." : "שלח הודעת בדיקה לעצמי"}
      </button>
      {message && (
        <span className="text-xs" style={{ color: message.ok ? "var(--ok)" : "var(--danger)" }}>
          {message.text}
        </span>
      )}
    </div>
  );
}

/**
 * חיבור המספר עם קוד בן 8 תווים, בלי לסרוק QR.
 *
 * אחרי שהקוד מוצג הדף מתרענן כל חמש שניות, וברגע שהגשר מדווח "מחובר" המסך
 * הזה מתחלף לבד במסך הרגיל.
 */
export function PairingPanel({
  defaultPhone,
  onRequest,
}: {
  defaultPhone: string;
  onRequest: (phone: string) => Promise<PairResult>;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(defaultPhone);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [code, router]);

  return (
    <section className="card flex flex-wrap items-start gap-7">
      <div className="min-w-0 flex-[1_1_340px]">
        <h2 className="card-title">חיבור המספר</h2>
        <p className="mt-1 text-[12.5px] text-[var(--muted)]">לוקח פחות מדקה. לא צריך לסרוק כלום.</p>

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await onRequest(phone);
              if (result.ok) setCode(result.code);
              else setError(result.error);
            });
          }}
        >
          <label className="field-label flex-[1_1_180px]">
            המספר בוואטסאפ ביזנס
            <input
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="input data text-right"
            />
          </label>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "מבקש..." : code ? "קוד חדש" : "קבל קוד חיבור"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}

        <ol className="mt-5 flex list-decimal flex-col gap-2 pr-5 text-[13px] leading-relaxed">
          <li>
            בטלפון, פותחים את <strong>וואטסאפ ביזנס</strong>
          </li>
          <li>
            <strong>הגדרות ← מכשירים מקושרים ← קישור מכשיר</strong>
          </li>
          <li>
            למטה: <strong>&quot;קשר עם מספר טלפון במקום&quot;</strong>
          </li>
          <li>מקלידים את הקוד שמופיע כאן</li>
        </ol>
      </div>

      <div className="min-w-0 flex-[1_1_300px] rounded-[14px] bg-[var(--surface-sunken)] p-5 text-center">
        <p className="text-xs text-[var(--muted)]">קוד החיבור</p>
        <p
          dir="ltr"
          className="data mt-3 text-[32px] font-medium tracking-[0.12em]"
          aria-live="polite"
        >
          {code ? `${code.slice(0, 4)}-${code.slice(4)}` : "— — — —"}
        </p>
        <p className="mt-3 text-xs text-[var(--subtle)]">
          {code
            ? "תקף כדקה-שתיים. הדף יתעדכן מעצמו כשהחיבור יצליח."
            : "הקוד יופיע כאן אחרי הלחיצה על \"קבל קוד חיבור\"."}
        </p>
      </div>
    </section>
  );
}
