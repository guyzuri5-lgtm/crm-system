// פריסה ציבורית — בלי הניווט, שם המשתמש וכפתור ההתנתקות של הדשבורד. הלקוח
// שמגיע לקישור לא אמור לדעת שיש מאחורי זה CRM.
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">{children}</div>
    </div>
  );
}
