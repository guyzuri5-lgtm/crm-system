import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkelCard lines={3} />
      <SkelCard lines={3} />
      <SkelCard lines={3} />
    </PageSkeleton>
  );
}
