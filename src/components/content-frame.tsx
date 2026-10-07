/**
 * גאנט התוכן הוא אפליקציה שלמה ב-JavaScript נקי (public/content-app), עם העיצוב
 * וההתנהגות שלו — ולכן הוא יושב ב-iframe ולא נכתב מחדש ב-React. הוא מאותו מקור,
 * כך שהקריאות שלו ל-/api/content/* נושאות את אותה עוגיית התחברות, וגם הקבצים
 * שלו עוברים דרך proxy.ts — מי שלא מחובר מופנה ל-/login.
 *
 * view קובע מה הגאנט מציג: הלוח, בנק האוטומציות, או ניתוח הרילז. כל אחד הוא
 * פריט נפרד בתפריט, ו-iframe נפרד: המעבר ביניהם טוען את האפליקציה מחדש, וזה
 * המחיר ההוגן של "כל מסך בכתובת משלו".
 */
export function ContentFrame({ view, query = "" }: { view: "board" | "automations" | "reels"; query?: string }) {
  const src = `/content-app/index.html?view=${view}${query ? `&${query}` : ""}`;
  return (
    <iframe
      key={src}
      src={src}
      title={view === "automations" ? "בנק אוטומציות" : view === "reels" ? "ניתוח רילז" : "גאנט תוכן"}
      className="w-full flex-1 border-0"
      style={{ minHeight: "calc(100dvh - 49px)" }}
    />
  );
}

/** רק פרמטרים שהגאנט מכיר, ורק תווים בטוחים — לא מעבירים לתוך ה-iframe קלט חופשי */
export function frameQuery(sp: Record<string, string | string[] | undefined>, keys: string[]) {
  const q = new URLSearchParams();
  for (const k of keys) {
    const v = sp[k];
    if (typeof v === "string" && /^[\w\-:.]{1,80}$/.test(v)) q.set(k, v);
  }
  return q.toString();
}
