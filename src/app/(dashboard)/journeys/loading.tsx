import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard, SkelCardGrid } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="מסעות לקוח">
      <SkelCard lines={3} />
      <SkelCardGrid count={4} lines={3} />
    </PageSkeleton>
  );
}
