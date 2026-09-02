import { verifyTeamMember } from "@/lib/dal";
import { signOut } from "@/app/login/actions";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { email } = await verifyTeamMember();

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav email={email ?? null} signOutAction={signOut} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
