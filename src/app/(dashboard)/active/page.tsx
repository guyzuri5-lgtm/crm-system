import { redirect } from "next/navigation";
import { verifyTeamMember } from "@/lib/dal";
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
      <div>
        <h1 className="text-xl font-semibold">מי שיצר קשר</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מי שיזם משהו — שלח הודעה, מילא שאלון, נרשם לאירוע, קבע או ביטל פגישה. לחיצה על שורה
          פותחת את השיחה המלאה.
        </p>
      </div>

      <ActiveList mode="inbound" />
    </div>
  );
}
