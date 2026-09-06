import { SkelBox, SkelLine, SkelCard } from "@/components/skeleton";

/**
 * כרטיס הלקוח: שיחה רחבה משמאל, פרטים מימין. השלד שומר על אותה חלוקה, כדי
 * שהעמודות לא יזוזו כשהשיחה מגיעה.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <SkelLine w="90px" h={12} />

      <div className="h-page">
        <div className="flex items-center gap-3">
          <SkelBox size={42} radius={13} />
          <div className="flex flex-col gap-2">
            <SkelLine w="180px" h={20} />
            <SkelLine w="150px" h={11} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="card flex flex-col gap-4 p-0">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <SkelLine w="120px" h={13} />
          </div>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {[72, 56, 88, 48, 64].map((h, i) => (
              <div key={i} className={i % 2 ? "flex justify-start" : "flex justify-end"}>
                <div className="skeleton" style={{ width: "62%", height: h, borderRadius: 14 }} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <SkelCard lines={5} />
          <SkelCard lines={3} />
        </div>
      </div>
    </div>
  );
}
