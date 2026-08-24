import { LoginForm } from "./login-form";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const nextParam = searchParams.next;
  const next = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/contacts";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_50%_0%,var(--primary-soft),var(--background)_55%)] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid size-11 place-items-center rounded-2xl bg-[var(--primary)] text-sm font-bold text-white shadow-sm">
            CRM
          </span>
          <div>
            <h1 className="text-lg font-semibold">כניסה למערכת</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">לצוות בלבד</p>
          </div>
        </div>
        <div className="card">
          <LoginForm next={next} />
        </div>
        <p className="mt-4 text-center text-xs text-[var(--subtle)]">
          משתמשים חדשים מתווספים דרך Supabase Auth (ראו README)
        </p>
      </div>
    </div>
  );
}
