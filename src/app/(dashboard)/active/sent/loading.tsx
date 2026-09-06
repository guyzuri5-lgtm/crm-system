import { PageSkeleton } from "@/components/page-skeleton";
import { SkelList } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton title="נשלח אליהם">
      <SkelList rows={7} />
    </PageSkeleton>
  );
}
