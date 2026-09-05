import { verifyTeamMember } from "@/lib/dal";
import { ActiveList } from "../active-list";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  await verifyTeamMember();

  return (
    <div className="flex flex-col gap-5">
      <div className="h-page">
        <div>
          <h1>נשלח אליהם</h1>
          <p>
            מי שקיבל ממך מייל או וואטסאפ ומעולם לא הגיב. ניוזלטר אחד מייצר כאן מאות שורות בבת
            אחת, ולכן הן יושבות בנפרד ולא מציפות את מי שבאמת כתב.
          </p>
        </div>
      </div>

      <ActiveList mode="sent" />
    </div>
  );
}
