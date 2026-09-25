import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import type { Database } from "./supabase/database.types";

/**
 * הדופק של המתזמן.
 *
 * ── למה זה קיים ──
 * ב-25.9.2026 GitHub Actions ירד מ-96 ריצות ביום לשש. הקוד היה תקין, כל
 * ריצה שכן יצאה לדרך הצליחה תוך 10 שניות, והמערכת לא הראתה דבר — כי לא היה
 * במסד שום מקום שאומר "רצתי". ההתדרדרות נמשכה יומיים עד שלקוחה ששילמה על
 * קורס ולא קיבלה אותו הייתה זו שגילתה אותה.
 *
 * **הכשל של מתזמן הוא כשל שקט מטבעו.** אין שגיאה, אין חריגה, אין שורה
 * אדומה — פשוט לא קורה כלום. זו הסיבה היחידה שהמודול הזה קיים: להפוך
 * היעדר לנוכחות שאפשר לראות.
 */

/** מעבר לזה כבר לא "בזמן". המתזמן אמור לרוץ כל חמש דקות. */
const LATE_AFTER_MINUTES = 20;

/** מעבר לזה זו תקלה, לא איחור: יותר משעה בלי ריצה פוגע בתזכורות לפגישות. */
const STALE_AFTER_MINUTES = 60;

/**
 * ריצה שהתחילה ולא הסתיימה נחשבת "נקטעה" רק אחרי שהיה לה זמן סביר לסיים.
 * תקציב הריצה הוא 280 שניות, ולכן עשר דקות הן שוליים נדיבים — בלעדיהן כל
 * בדיקה שנופלת *בתוך* ריצה חיה הייתה מדווחת על קטיעה.
 */
const INTERRUPTED_AFTER_MINUTES = 10;

export type CronState =
  /** אין ממה להסיק: המיגרציה לא רצה, או שהקרון לא רץ מעולם מאז שנוצרה. */
  | "unknown"
  /** רץ, הסתיים, ובזמן. */
  | "ok"
  /** רץ, אבל מזמן. */
  | "late"
  /** מזמן מדי. תזכורות לפגישות כבר לא אמינות. */
  | "stale"
  /** הריצה האחרונה זרקה. */
  | "failing"
  /** ריצה התחילה ולא הסתיימה — נקטעה באמצע. */
  | "interrupted";

export interface CronHealth {
  state: CronState;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  /** דקות מאז הסיום האחרון. null כשאין סיום. */
  minutesSince: number | null;
  error: string | null;
  /** הטבלה אינה קיימת — 0042 לא הורצה. */
  missing: boolean;
}

/**
 * קריאת המצב.
 *
 * **לא זורקת, לעולם.** היא נקראת ממסכים, וכשל שלה אסור שיפיל מסך — במיוחד
 * לא את דף הבית. כל כישלון חוזר כ-`unknown`, והמסך אומר "אין נתונים" במקום
 * להציג ירוק שאין מאחוריו דבר. זה בדיוק ההבדל שנלמד ב-4683d9c.
 */
export async function readCronHealth(now: Date = new Date()): Promise<CronHealth> {
  const empty: CronHealth = {
    state: "unknown",
    lastStartedAt: null,
    lastFinishedAt: null,
    minutesSince: null,
    error: null,
    missing: false,
  };

  try {
    const { data, error } = await supabaseAdmin()
      .from("cron_heartbeat")
      .select("last_started_at, last_finished_at, last_error")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      const missing = ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "");
      return { ...empty, missing };
    }
    if (!data) return empty;

    const startedAt = data.last_started_at as string | null;
    const finishedAt = data.last_finished_at as string | null;
    const lastError = (data.last_error as string | null) || null;

    const minutesSince = finishedAt ? minutesBetween(finishedAt, now) : null;

    // ── סדר ההכרעה, ולמה הוא כזה ──
    //
    // קודם כל "אין נתונים": בלי סיום מעולם אין על מה לבסס שום קביעה אחרת.
    if (minutesSince === null) {
      return { ...empty, lastStartedAt: startedAt, error: lastError };
    }

    // ריצה שהתחילה אחרי הסיום האחרון ולא נרשם לה סיום משלה — נקטעה. זה קודם
    // לשעון, כי ריצה שנקטעת כל פעם מחדש עדיין מעדכנת started ולכן תיראה
    // "טרייה" למי שמסתכל על השעון בלבד.
    const startedAfterFinish =
      startedAt !== null && new Date(startedAt) > new Date(finishedAt!);
    if (startedAfterFinish && minutesBetween(startedAt!, now) > INTERRUPTED_AFTER_MINUTES) {
      return {
        state: "interrupted",
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        minutesSince,
        error: lastError,
        missing: false,
      };
    }

    // שגיאה מהריצה האחרונה קודמת לשעון: קרון שרץ בזמן ונופל בכל פעם הוא
    // תקלה, ושעון בלבד היה מציג אותו כירוק.
    const state: CronState = lastError
      ? "failing"
      : minutesSince > STALE_AFTER_MINUTES
        ? "stale"
        : minutesSince > LATE_AFTER_MINUTES
          ? "late"
          : "ok";

    return {
      state,
      lastStartedAt: startedAt,
      lastFinishedAt: finishedAt,
      minutesSince,
      error: lastError,
      missing: false,
    };
  } catch {
    return empty;
  }
}

function minutesBetween(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
}

/**
 * רישום תחילת ריצה.
 *
 * **לא זורקת.** כתיבת הדופק היא תיעוד, והיא לא סיבה לבטל ריצת קרון שעומדת
 * לשלוח הודעות ללקוחות. אותו נימוק בדיוק כמו ב-recordIncoming של תיבת
 * ה-webhooks: רשת ביטחון שמפילה את מי שנופל לתוכה חסרת ערך.
 */
export async function recordCronStart(now: Date = new Date()): Promise<void> {
  await write({ last_started_at: now.toISOString() });
}

/** רישום סיום מוצלח. מנקה את השגיאה הקודמת — היא כבר אינה המצב הנוכחי. */
export async function recordCronFinish(summary: unknown, now: Date = new Date()): Promise<void> {
  await write({
    last_finished_at: now.toISOString(),
    last_summary: summary as Record<string, unknown>,
    last_error: null,
  });
}

/**
 * רישום ריצה שנפלה.
 *
 * last_finished_at מתעדכן גם כאן, ובכוונה: הריצה *כן* קרתה, והמתזמן *כן*
 * עובד. מה שנשבר הוא מה שקרה בתוכה, וזה מה ש-last_error אומר. בלי זה,
 * קרון בריא שנופל היה נראה במסך כמתזמן ישן — והתיקון היה מופנה למקום הלא נכון.
 */
export async function recordCronError(reason: string, now: Date = new Date()): Promise<void> {
  await write({ last_finished_at: now.toISOString(), last_error: reason.slice(0, 2000) });
}

type HeartbeatPatch = Database["public"]["Tables"]["cron_heartbeat"]["Update"];

async function write(patch: HeartbeatPatch): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("cron_heartbeat").update(patch).eq("id", true);
    if (error) console.error("[cron] כתיבת הדופק נכשלה:", error.message);
  } catch (err) {
    console.error("[cron] כתיבת הדופק נכשלה:", err instanceof Error ? err.message : err);
  }
}
