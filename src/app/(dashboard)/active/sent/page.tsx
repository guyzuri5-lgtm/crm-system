import { verifyTeamMember } from "@/lib/dal";
import { ActiveList } from "../active-list";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  await verifyTeamMember();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">נשלח אליהם</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מי שקיבל ממך מייל או וואטסאפ ומעולם לא הגיב. ניוזלטר אחד מייצר כאן מאות שורות בבת אחת,
          ולכן הן יושבות בנפרד ולא מציפות את מי שבאמת כתב.
        </p>
      </div>

      <ActiveList mode="sent" />
    </div>
  );
}
