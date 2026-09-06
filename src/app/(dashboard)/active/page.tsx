import { redirect } from "next/navigation";
import { Suspense } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { SkelList } from "@/components/skeleton";
import { ActiveList } from "./active-list";

export const dynamic = "force-dynamic";

export default async function ActivePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifyTeamMember();

  // ?all=1 היה המתג שהציג גם פניות יוצאות, לפני שהן קיבלו לשונית משלהן.
  // מי ששמר את הכתובת הזו מגיע למה שהוא התכוון אליו ולא לרשימה השנייה.
  const params = await searchParams;
  if (params.all === "1") redirect("/active/sent");

  return (
    <div className="flex flex-col gap-5">
      <div className="h-page">
        <div>
          <h1>מי שיצר קשר</h1>
          <p>
            מי שיזם משהו — שלח הודעה, מילא שאלון, נרשם לאירוע, קבע או ביטל פגישה. לחיצה על שורה
            פותחת את השיחה המלאה בלי לעזוב את הרשימה.
          </p>
        </div>
      </div>

      {/* הרשימה בזרם: הכותרת וההסבר נצבעים מיד, והשורות מחליפות את השלד
          כשהתצוגה חוזרת. בלי זה כל המסך המתין לשאילתה. */}
      <Suspense fallback={<SkelList rows={7} />}>
        <ActiveList mode="inbound" />
      </Suspense>
    </div>
  );
}
