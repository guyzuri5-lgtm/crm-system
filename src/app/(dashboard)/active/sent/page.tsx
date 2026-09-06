import { Suspense } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { SkelList } from "@/components/skeleton";
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

      <Suspense fallback={<SkelList rows={7} />}>
        <ActiveList mode="sent" />
      </Suspense>
    </div>
  );
}
