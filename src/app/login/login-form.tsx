"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="field-label">
        אימייל
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="input"
        />
      </label>
      <label className="field-label">
        סיסמה
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="input"
        />
      </label>
      {state?.error && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <button disabled={pending} type="submit" className="btn-primary mt-1 w-full">
        {pending ? "מתחבר…" : "כניסה"}
      </button>
    </form>
  );
}
