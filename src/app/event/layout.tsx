// פריסה ציבורית — בלי הניווט, שם המשתמש וכפתור ההתנתקות של הדשבורד, בדיוק
// כמו ב-/book. מי שמגיעה מקישור שיווקי לא אמורה לדעת שיש מאחורי זה CRM.
export default function EventLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}
