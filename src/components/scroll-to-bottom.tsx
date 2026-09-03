"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * מיכל גלילה שנפתח למטה, על ההודעה האחרונה.
 *
 * זו ההתנהגות של כל תוכנת מסרים, ובלעדיה שיחה ארוכה נפתחת על ההודעה הראשונה
 * משנה שעברה — כלומר על החלק היחיד שכבר לא מעניין. הגלילה קופצת ולא מונפשת
 * בכוונה: המשתמש לא "נסע" לסוף השיחה, הוא נחת שם.
 *
 * watch הוא מה שקובע מתי לגלול מחדש — מספר ההודעות. בלעדיו הגלילה הייתה רצה
 * אחרי כל רינדור ומושכת את המיכל חזרה למטה בזמן שהמשתמש גולל למעלה לקרוא.
 */
export function ScrollToBottom({
  watch,
  className,
  children,
}: {
  watch: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [watch]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
