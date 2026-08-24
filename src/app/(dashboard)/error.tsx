"use client";

// Catches errors thrown by Server Actions/Server Components under the dashboard (e.g.
// a template deleted while still referenced by a rule) so a mutation failure shows an
// inline message instead of the framework's generic crash page.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-12 flex max-w-md flex-col items-start gap-3">
      <span className="grid size-9 place-items-center rounded-full bg-[var(--danger-soft)] text-[var(--danger)]">
        !
      </span>
      <h2 className="font-semibold">משהו השתבש</h2>
      <p className="text-sm text-[var(--muted)]">{error.message}</p>
      <button onClick={() => reset()} className="btn-secondary">
        נסה שוב
      </button>
    </div>
  );
}
