import { PageSkeleton } from "@/components/page-skeleton";
import { SkelCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="הודעה חדשה">
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <SkelCard lines={8} />
        <SkelCard lines={6} />
      </div>
    </PageSkeleton>
  );
}
