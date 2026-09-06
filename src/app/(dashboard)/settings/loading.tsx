import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkelCard lines={4} />
      <SkelCard lines={4} />
    </PageSkeleton>
  );
}
