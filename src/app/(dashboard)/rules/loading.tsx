import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="כללים">
      <SkelCard lines={4} />
      <SkelCard lines={2} />
      <SkelCard lines={2} />
    </PageSkeleton>
  );
}
