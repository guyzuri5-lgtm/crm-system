import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCardGrid } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <SkelCardGrid count={3} lines={4} />
    </PageSkeleton>
  );
}
