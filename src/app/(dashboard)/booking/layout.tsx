// לשוניות המשנה של הפגישות עברו לסרגל הראשי (src/components/dashboard-shell.tsx),
// ואיתן גם הכותרת — כל עמוד כותב את שלו. נשארה רק המעטפת של המרווחים.
export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}
