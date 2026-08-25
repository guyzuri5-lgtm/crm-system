import { BookingTabs } from "./tabs";

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">פגישות</h1>
      <BookingTabs />
      {children}
    </div>
  );
}
