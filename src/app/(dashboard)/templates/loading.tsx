import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard, SkelCardGrid } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="תבניות הודעה">
      <SkelCard lines={4} />
      <SkelCardGrid count={4} lines={3} />
    </PageSkeleton>
  );
}
