import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { signOut } from "@/app/login/actions";

const NAV_LINKS = [
  { href: "/contacts", label: "אנשי קשר" },
  { href: "/statuses", label: "סטטוסים" },
  { href: "/rules", label: "כללי אוטומציה" },
  { href: "/templates", label: "תבניות הודעה" },
  { href: "/booking", label: "פגישות" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { email } = await verifyTeamMember();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <nav className="flex items-center gap-1">
            <span className="ml-3 flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-7 place-items-center rounded-lg bg-[var(--primary)] text-xs font-bold text-white">
                CRM
              </span>
            </span>
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--muted)] transition-colors duration-150 hover:bg-[var(--background)] hover:text-[var(--foreground)]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            {email && <span className="hidden sm:inline">{email}</span>}
            <form action={signOut}>
              <button type="submit" className="btn-ghost">
                התנתקות
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
