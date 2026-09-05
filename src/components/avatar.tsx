/**
 * אווטר ראשי תיבות — מחליף תמונת פרופיל שאין לנו.
 *
 * העין מוצאת צורה קבועה בתחילת שורה מהר יותר משהיא קוראת שם, ולכן זה עוזר
 * דווקא ברשימות ארוכות: מי שסורק מאה שורות מזהה את השורה שהוא מחפש לפי
 * המיקום והצבע עוד לפני שקרא מילה.
 */

/** שתי אותיות ראשונות משתי המילים הראשונות בשם. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => [...word][0])
    .join("");
}

export function Avatar({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`av ${className}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
