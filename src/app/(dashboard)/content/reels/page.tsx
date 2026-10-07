import { verifyTeamMember } from "@/lib/dal";
import { ContentFrame } from "@/components/content-frame";

export const dynamic = "force-dynamic";

/** ניתוח הרילז: הוקים, חשיפה ומה להמשיך/להפסיק. השליפה מאינסטגרם דרך Composio. */
export default async function ContentReelsPage() {
  await verifyTeamMember();
  return <ContentFrame view="reels" />;
}
