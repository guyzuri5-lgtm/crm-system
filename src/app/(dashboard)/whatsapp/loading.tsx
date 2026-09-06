import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard, SkelMetricRow } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="ערוץ הוואטסאפ">
      <SkelMetricRow count={3} />
      <SkelCard lines={3} />
      <SkelCard lines={4} />
    </PageSkeleton>
  );
}
