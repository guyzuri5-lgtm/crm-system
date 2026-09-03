import type { InteractionType } from "@/lib/supabase/database.types";

/**
 * השיחה עם איש קשר, בפריסה של תוכנת מסרים מיידיים.
 *
 * הרכיב הזה מכוון בכוונה להיות חסר-צד: אין בו "use client" ואין בו ייבוא
 * server-only, ולכן אותו קובץ מרונדר גם בשרת (דף איש הקשר) וגם בדפדפן
 * (השורה הנפתחת ב"לקוחות פעילים", שמושכת את השיחה לפי דרישה). שכפול לשני
 * רכיבים היה מבטיח שהשניים יסטו זה מזה תוך שבוע.
 *
 * מה שהיה כאן קודם היה רשימה שטוחה שבה כל שורה נראתה אותו דבר — "וואטסאפ →
 * יוצא" מעל "וואטסאפ ← נכנס". קריאת שיחה כזו דורשת לפענח כל שורה מחדש. כאן
 * הצד של הבועה עושה את העבודה: מה שהלקוח כתב מימין, מה שיצא ממך משמאל,
 * בדיוק כמו בוואטסאפ בעברית.
 */

/** מבנה מינימלי — תואם מבנית ל-Interaction, בלי לגרור את כל השורה לדפדפן. */
export interface ConversationMessage {
  id: string;
  type: InteractionType;
  content: string | null;
  created_at: string;
}

/**
 * שלוש קבוצות ולא שתיים. "נכנס" ו"יוצא" הן שני צדי השיחה, אבל מילוי שאלון או
 * קביעת פגישה אינם הודעה של אף אחד מהצדדים — הם דבר שקרה. בוואטסאפ אלה
 * השורות הקטנות שבאמצע, וזה בדיוק המקום הנכון להן גם כאן.
 */
type Side = "in" | "out" | "system";

const SIDE: Record<InteractionType, Side> = {
  whatsapp_in: "in",
  whatsapp_out: "out",
  email_out: "out",
  manual_note: "system",
  quiz_submitted: "system",
  booking_created: "system",
  booking_cancelled: "system",
  course_lead: "system",
  event_registered: "system",
};

const SYSTEM_LABELS: Partial<Record<InteractionType, string>> = {
  manual_note: "הערה פנימית",
  quiz_submitted: "מילא שאלון",
  booking_created: "קבע פגישה",
  booking_cancelled: "ביטל פגישה",
  course_lead: "השאיר פרטים לקורס",
  event_registered: "נרשמה לאירוע",
};

/**
 * אזור הזמן ננעל במפורש. השרת רץ ב-UTC ב-Vercel, ובלי הנעילה הזו שעת הודעה
 * שנשלחה ב-22:00 הייתה מוצגת כ-19:00 — הפרש שלוש שעות שנראה כמו נתון אמיתי
 * ולכן אף אחד לא מבחין בו.
 */
const TZ = "Asia/Jerusalem";

const timeFmt = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

const dayFmt = new Intl.DateTimeFormat("he-IL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});

/** מפתח יציב ליום לפי שעון ישראל (YYYY-MM-DD), לקיבוץ מתחת לחוצץ התאריך. */
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TZ,
});

function dayLabel(iso: string): string {
  const key = dayKeyFmt.format(new Date(iso));
  const today = dayKeyFmt.format(new Date());
  if (key === today) return "היום";

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (key === dayKeyFmt.format(yesterdayDate)) return "אתמול";

  return dayFmt.format(new Date(iso));
}

export function Conversation({
  messages,
  emptyText = "אין עדיין שיחה עם איש הקשר הזה.",
}: {
  messages: ConversationMessage[];
  emptyText?: string;
}) {
  if (!messages.length) {
    return <p className="py-6 text-center text-sm text-[var(--subtle)]">{emptyText}</p>;
  }

  // השיחה נקראת מלמעלה למטה — הישן ראשון. השאילתות במערכת מחזירות את החדש
  // ראשון (זה מה שנכון לרשימות), ולכן ההיפוך נעשה כאן ולא בכל קורא בנפרד.
  const ordered = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // חוצץ התאריך נגזר מראש ולא נצבר תוך כדי הרינדור: השוואה לשכן הקודם היא
  // חישוב טהור, בעוד משתנה שמתעדכן בתוך map חי בין רינדורים ומתנהג אחרת
  // בפעם השנייה.
  const items = ordered.map((message, index) => {
    const dayKey = dayKeyFmt.format(new Date(message.created_at));
    const previousKey =
      index > 0 ? dayKeyFmt.format(new Date(ordered[index - 1].created_at)) : null;
    return { message, showDay: dayKey !== previousKey };
  });

  return (
    <div className="flex flex-col gap-1.5">
      {items.map(({ message, showDay }) => {
        const side = SIDE[message.type] ?? "system";

        return (
          <div key={message.id} className="flex flex-col gap-1.5">
            {showDay && (
              <div className="my-2 flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-xs font-medium text-[var(--subtle)]">
                  {dayLabel(message.created_at)}
                </span>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}

            {side === "system" ? (
              <SystemLine message={message} />
            ) : (
              <Bubble message={message} side={side} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SystemLine({ message }: { message: ConversationMessage }) {
  const label = SYSTEM_LABELS[message.type] ?? message.type;

  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-full bg-[var(--background)] px-3 py-1 text-center text-xs text-[var(--muted)] ring-1 ring-inset ring-[var(--border)]">
        <span className="font-medium">{label}</span>
        {message.content && <span> · {message.content}</span>}
        <span className="text-[var(--subtle)]"> · {timeFmt.format(new Date(message.created_at))}</span>
      </div>
    </div>
  );
}

function Bubble({ message, side }: { message: ConversationMessage; side: "in" | "out" }) {
  const incoming = side === "in";
  const isEmail = message.type === "email_out";

  return (
    <div className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          incoming
            ? "rounded-ss-sm bg-white ring-1 ring-inset ring-[var(--border)]"
            : "rounded-se-sm bg-[var(--primary-soft)]",
        ].join(" ")}
      >
        {/*
          מייל מסומן במפורש. המערכת שומרת ממנו רק את הכותרת ולא את הגוף, ובלי
          התווית הזו בועה שכתוב בה "אישור הרשמה" נקראת כאילו זו ההודעה השלמה
          שנשלחה — והיא לא.
        */}
        {isEmail && (
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            מייל · נושא בלבד
          </span>
        )}

        <p className="whitespace-pre-wrap">{message.content || "—"}</p>

        <span
          className={`mt-0.5 block text-[11px] text-[var(--subtle)] ${incoming ? "text-start" : "text-end"}`}
        >
          {timeFmt.format(new Date(message.created_at))}
        </span>
      </div>
    </div>
  );
}
