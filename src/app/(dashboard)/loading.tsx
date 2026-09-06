import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard } from "@/components/skeleton";

/**
 * שלד ברירת המחדל של הדשבורד.
 *
 * חל על כל מסך שאין לו loading.tsx משלו, ובעיקר: הוא מה שגורם ללחיצה על
 * פריט בסרגל לעשות משהו *מיד*. בלי הקובץ הזה Next אינו מציג דבר עד
 * שהשאילתה האחרונה של העמוד חזרה — המסך הישן פשוט נשאר, והמערכת נראית
 * תקועה. בנוסף, עמוד דינמי בלי loading.tsx כלל אינו נשלף מראש (prefetch),
 * ולכן הלחיצה מתחילה מאפס.
 */
export default function Loading() {
  return (
    <PageSkeleton>
      <SkelCard lines={4} />
      <SkelCard lines={3} />
    </PageSkeleton>
  );
}
