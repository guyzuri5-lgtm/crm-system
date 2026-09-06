import { PageSkeleton } from "@/components/page-skeleton";
import { SkelTable, SkelCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="כל אנשי הקשר">
      <SkelCard lines={1} title={false} />
      <SkelTable rows={10} cols={5} />
    </PageSkeleton>
  );
}
