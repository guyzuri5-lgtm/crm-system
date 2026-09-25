import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SkelLine, SkelBox } from "@/components/skeleton";
import { Chat, Clock, Route, School, glyphStyle, pillStyle } from "./parts";
import { bounds, channelHealth, journeyCounts, schedulerHealth } from "./data";

/**
 * שורת המצב בתחתית דף הבית.
 *
 * ── המתזמן, סוף סוף ──
 * כאן היה כתוב שהוא "היה אמור לשבת כאן, אבל אין טבלה שרושמת את ריצות
 * הקרון". ב-25.9.2026 החסר הזה נגבה: GitHub ירד מ-96 ריצות ביום לשש,
 * ההתדרדרות רצה יומיים בשקט, ולקוחה ששילמה על קורס גילתה אותה. 0042 יצרה
 * את הטבלה, והכרטיס נכנס למקום שיועד לו מלכתחילה.
 *
 * הוא ראשון בשורה ולא אחרון, כי כשהוא אדום כל השאר במסך מושהה ממילא.
 *
 * זה המקטע היחיד שממתין לקריאת הרשת אל Meta, והוא בתחתית המסך — כלומר
 * ההמתנה היקרה ביותר בדף יושבת במקום שנקרא אחרון.
 */
export async function StatusRow() {
  const db = supabaseAdmin();
  const { sevenDaysAgo } = bounds();

  const [
    scheduler,
    channel,
    journeys,
    { data: courseInterestedRaw },
    { count: newCourseInterestCount },
  ] = await Promise.all([
    schedulerHealth(),
    channelHealth(),
    journeyCounts(),
    db.from("course_registrations").select("contact_id").eq("stage", "interested"),
    db
      .from("course_registrations")
      .select("id", { count: "exact", head: true })
      .eq("stage", "interested")
      .gte("created_at", sevenDaysAgo),
  ]);

  const courseInterestedCount = new Set((courseInterestedRaw ?? []).map((r) => r.contact_id)).size;
  const { health, phone } = channel;

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Link href="/settings/sending" className="card flex items-center gap-3 px-4 py-3.5">
        <span className="glyph size-8" style={glyphStyle(scheduler.color, scheduler.soft)}>
          <Clock size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold break-words">
            המתזמן · {scheduler.health.text}
          </span>
          <span className="block text-[11.5px] break-words text-[var(--muted)]">
            {scheduler.hint}
          </span>
        </span>
      </Link>

      <Link href="/whatsapp" className="card flex items-center gap-3 px-4 py-3.5">
        <span className="glyph size-8" style={glyphStyle(channel.color, channel.soft)}>
          <Chat size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold break-words">{health.text}</span>
          <span className="block text-[11.5px] text-[var(--muted)]">
            ערוץ הוואטסאפ
            {phone?.displayPhoneNumber && (
              <>
                {" · "}
                {/* בלי dir המספר נשבר: הדפדפן מסדר את הקטעים שלו מימין לשמאל. */}
                <span className="data" dir="ltr">
                  {phone.displayPhoneNumber}
                </span>
              </>
            )}
          </span>
        </span>
        {/* רק כשהאיכות ירוקה: בכל מצב אחר הכותרת כבר אומרת את זה, והתווית
            הייתה חוזרת על עצמה. */}
        {health.tone === "ok" && phone?.qualityRating === "GREEN" && (
          <span className="pill" style={pillStyle("var(--ok)", "var(--ok-soft)")}>
            איכות ירוקה
          </span>
        )}
      </Link>

      <Link href="/journeys" className="card flex items-center gap-3 px-4 py-3.5">
        <span
          className="glyph size-8"
          style={glyphStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
        >
          <Route size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold">
            {journeys.enrolled} אנשים במסעות כרגע
          </span>
          <span className="block text-[11.5px] text-[var(--muted)]">
            {journeys.active} מסעות פעילים
          </span>
        </span>
      </Link>

      <Link href="/courses" className="card flex items-center gap-3 px-4 py-3.5">
        <span className="glyph size-8" style={glyphStyle("var(--nav-blue)", "var(--nav-blue-soft)")}>
          <School size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold">
            {courseInterestedCount} מתעניינים בקורסים
          </span>
          <span className="block text-[11.5px] text-[var(--muted)]">
            {newCourseInterestCount ?? 0} חדשות השבוע
          </span>
        </span>
      </Link>
    </section>
  );
}

export function StatusRowFallback() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card flex items-center gap-3 px-4 py-3.5">
          <SkelBox size={32} radius={10} />
          <div className="flex flex-1 flex-col gap-2">
            <SkelLine w="65%" h={13} />
            <SkelLine w="45%" h={11} />
          </div>
        </div>
      ))}
    </section>
  );
}
