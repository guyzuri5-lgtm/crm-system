import { verifyTeamMember } from "@/lib/dal";
import { ContentFrame, frameQuery } from "@/components/content-frame";

export const dynamic = "force-dynamic";

/** בנק אוטומציות התגובה (אינסטגרם): אוטומציה אחת, הרבה פוסטים. ?id=<uuid> פותח אוטומציה. */
export default async function ContentAutomationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await verifyTeamMember();
  return <ContentFrame view="automations" query={frameQuery(await searchParams, ["id"])} />;
}
