import { PageSkeleton } from "@/components/page-skeleton";
import { SkelList } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="מי שיצר קשר">
      <SkelList rows={7} />
    </PageSkeleton>
  );
}
