import { verifyTeamMember } from "@/lib/dal";
import { ContentFrame, frameQuery } from "@/components/content-frame";

export const dynamic = "force-dynamic";

/** גאנט התוכן: תכנון ותזמון לאינסטגרם/פייסבוק/טיקטוק/יוטיוב דרך Zernio. ?item=<id> פותח פריט. */
export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await verifyTeamMember();
  return <ContentFrame view="board" query={frameQuery(await searchParams, ["item"])} />;
}
