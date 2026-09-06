import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Avatar } from "@/components/avatar";
import { SkelLine, SkelBox } from "@/components/skeleton";
import type { Contact } from "@/lib/supabase/database.types";
import { Alert, Ticket, Route, glyphStyle, pillStyle } from "./parts";
import { bounds, daysSince, DAY_MS, NO_REPLY_DAYS, URGENT_DAYS } from "./data";

/**
 * "דורש טיפול" = **מי שפנה אלינו ומחכה**, ולא "מי ששותק".
 *
 * קודם הקריטריון היה זהה לזה של טריגר הכללים: שתיקה של שלושה ימים, או —
 * למי שמעולם לא כתב — שלושה ימים מאז שנוצר. הסעיף השני הוא זה שהרס את
 * הכרטיס: הוא תפס כל איש קשר שיובא מאקסל ומעולם לא פנה, כלומר 721 מתוך
 * 724. מספר כזה אינו רשימת מטלות, והשמות שהוצגו תחתיו היו לידים מיובאים
 * שלא כתבו מילה — עם תווית "11 ימים" שמרמזת על נטישה שלא הייתה.
 *
 * ההבחנה הנכונה כבר קיימת במערכת ועליה בנוי /active: last_customer_at
 * סופר רק מה שהלקוח *יזם* (הודעה נכנסת, שאלון, קביעת פגישה או ביטול).
 * אותו שדה מזין כאן גם את המונה וגם את השמות, ולכן הכרטיס מסכים סוף סוף
 * עם המדד "לקוחות פעילים" שיושב שני סנטימטרים ממנו.
 */
export async function Attention() {
  const db = supabaseAdmin();
  const { now, noReplyCutoff } = bounds();

  const [
    { data: quietRowsRaw, count: quietTotal },
    { count: unpaidCount },
    { data: courseInterestedRaw },
    { data: eventInterestedRaw },
    { data: enrolledRaw },
  ] = await Promise.all([
    // ה-count מגיע על אותה שאילתה ולא בנוספת: הכרטיס מציג חמישה שמות אבל
    // התווית בכותרת סופרת את כולם.
    db
      .from("contact_activity")
      .select("contact_id, last_customer_at, last_inbound_text", { count: "exact" })
      .not("last_customer_at", "is", null)
      .lte("last_customer_at", noReplyCutoff)
      .order("last_customer_at", { ascending: false })
      .limit(5),
    db
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("stage", "registered")
      .lte("created_at", new Date(now.getTime() - DAY_MS).toISOString()),
    // ── קורסים (0028) ──
    // שלוש שאילתות רזות שמחזירות contact_id בלבד: הצטלבות "מי מתעניינת"
    // מול "מי כבר במסע" נעשית בזיכרון, כי PostgREST לא יודע NOT IN על
    // תת-שאילתה. אם 0028 טרם רצה, השגיאה נבלעת ו-null הופך לרשימה ריקה —
    // דף הבית ממשיך לעבוד בדיוק כמו קודם.
    db.from("course_registrations").select("contact_id").eq("stage", "interested"),
    db.from("event_registrations").select("contact_id").eq("stage", "interested"),
    db.from("journey_enrollments").select("contact_id"),
  ]);

  /** שורות התצוגה שמזינות את "דורש טיפול" — מי פנה, מתי, ומה כתב. */
  const quietRows = (quietRowsRaw ?? []) as {
    contact_id: string;
    last_customer_at: string;
    last_inbound_text: string | null;
  }[];

  // השמות והטלפונים של אותן חמש שורות. התצוגה כבר מחזיקה את מה שהן כתבו
  // ואת מתי פנו, ולכן זו שליפה אחת לפי מזהים ולא שאילתה לכל שורה.
  const { data: quietContacts } = quietRows.length
    ? await db
        .from("contacts")
        .select("id, full_name, phone, created_at")
        .in(
          "id",
          quietRows.map((row) => row.contact_id)
        )
    : { data: [] };

  const lastTextById = new Map(quietRows.map((row) => [row.contact_id, row.last_inbound_text]));
  /** מתי אותו אדם פנה בפעם האחרונה — זה מה שנספר כ"כמה ימים הוא מחכה". */
  const quietSinceById = new Map(quietRows.map((row) => [row.contact_id, row.last_customer_at]));

  // הסדר של contact_activity הוא זה שנשמר (היורד לפי last_customer_at); שליפת
  // אנשי הקשר לפי מזהים מחזירה סדר משלה, ולכן היא ממופה ולא נלקחת כמו שהיא.
  type QuietContact = Pick<Contact, "id" | "full_name" | "phone" | "created_at">;
  const contactById = new Map(((quietContacts ?? []) as QuietContact[]).map((c) => [c.id, c]));
  const quiet = quietRows
    .map((row) => contactById.get(row.contact_id))
    .filter((c): c is QuietContact => Boolean(c));

  // ── מתעניינות ──
  const courseInterested = (courseInterestedRaw ?? []).map((r) => r.contact_id);

  // מי שהשאירה פרטים ואף אחד לא בנה לה המשך. זו הרשימה שהמסעות נועדו לה,
  // ולכן "מתעניינת שאינה באף מסע" היא הפער האמיתי — לא מספר המתעניינות.
  const enrolledIds = new Set((enrolledRaw ?? []).map((r) => r.contact_id));
  const interestedIds = new Set([
    ...courseInterested,
    ...(eventInterestedRaw ?? []).map((r) => r.contact_id),
  ]);
  const unlinkedInterestedCount = [...interestedIds].filter((id) => !enrolledIds.has(id)).length;

  const attentionTotal = (quietTotal ?? 0) + (unpaidCount ?? 0) + unlinkedInterestedCount;

  return (
    <section className="card flex flex-col p-0">
      <div className="card-h">
        <span className="glyph" style={glyphStyle("var(--nav-coral)", "var(--nav-coral-soft)")}>
          <Alert />
        </span>
        <h2>דורש טיפול</h2>
        <span className="flex-1" />
        {attentionTotal > 0 && (
          <span className="pill" style={pillStyle("var(--nav-coral)", "var(--nav-coral-soft)")}>
            {attentionTotal}
          </span>
        )}
      </div>

      <div className="card-b">
        {attentionTotal === 0 ? (
          <p className="py-2 text-sm text-[var(--muted)]">הכול מטופל ✔</p>
        ) : (
          <>
            {quiet.map((contact) => {
              const name = contact.full_name || contact.phone || "ללא שם";
              const said = lastTextById.get(contact.id);
              // מאז שהוא פנה, ולא מאז שנוצר: השורות האלה הן אנשים שיזמו
              // משהו, וזה הרגע שממנו הם מחכים.
              const days = daysSince(quietSinceById.get(contact.id) ?? contact.created_at, now);
              const urgent = days >= URGENT_DAYS;
              return (
                <div
                  key={contact.id}
                  className="flex items-center gap-2.5 border-b border-[var(--border)] py-2.5 last:border-b-0"
                >
                  <Avatar name={name} />
                  <span className="min-w-0 flex-1">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="block truncate text-[13px] font-medium hover:underline"
                    >
                      {name}
                    </Link>
                    {said && (
                      <span className="block truncate text-[11px] text-[var(--muted)]">{said}</span>
                    )}
                  </span>
                  <span
                    className="pill"
                    style={
                      urgent
                        ? pillStyle("var(--nav-coral)", "var(--nav-coral-soft)")
                        : pillStyle("var(--nav-amber)", "var(--nav-amber-soft)")
                    }
                  >
                    {days} ימים
                  </span>
                </div>
              );
            })}

            {(Boolean(unpaidCount) || unlinkedInterestedCount > 0) && (
              <div className={`flex flex-col gap-2 ${quiet.length ? "mt-3" : ""}`}>
                {/* מי שהשאירה פרטים, יצאה לתשלום ולא חזרה. יממה היא הסף
                    שבו זה מפסיק להיות "היא עוד באמצע" ומתחיל להיות
                    "צריך לפנות אליה". */}
                {Boolean(unpaidCount) && (
                  <Link href="/events" className="group-row">
                    <span
                      className="glyph size-6"
                      style={glyphStyle("var(--nav-pink)", "var(--nav-pink-soft)")}
                    >
                      <Ticket size={13} />
                    </span>
                    <b className="font-semibold">נרשמו לאירוע ולא שילמו</b>
                    <span className="flex-1" />
                    <span className="pill" style={pillStyle("var(--nav-pink)", "var(--nav-pink-soft)")}>
                      {unpaidCount}
                    </span>
                  </Link>
                )}

                {/* מתעניינת שאינה באף מסע היא ליד שנפל בין הכיסאות: היא
                    השאירה פרטים, ואיש לא בנה לה המשך. הקישור מוביל
                    למסעות, כי זו הפעולה שסוגרת את הפער. */}
                {unlinkedInterestedCount > 0 && (
                  <Link href="/journeys" className="group-row">
                    <span
                      className="glyph size-6"
                      style={glyphStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
                    >
                      <Route size={13} />
                    </span>
                    <b className="font-semibold">מתעניינות שאינן באף מסע</b>
                    <span className="flex-1" />
                    <span
                      className="pill"
                      style={pillStyle("var(--nav-purple)", "var(--nav-purple-soft)")}
                    >
                      {unlinkedInterestedCount}
                    </span>
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card-f mt-auto">
        מי שפנה אלינו ולא קיבל מענה {NO_REPLY_DAYS} ימים ומעלה נכנס לרשימה אוטומטית. מי שיובא
        מאקסל ומעולם לא כתב אינו נספר כאן.
      </div>
    </section>
  );
}

export function AttentionFallback() {
  return (
    <section className="card flex flex-col p-0">
      <div className="card-h">
        <span className="glyph" style={glyphStyle("var(--nav-coral)", "var(--nav-coral-soft)")}>
          <Alert />
        </span>
        <h2>דורש טיפול</h2>
      </div>
      <div className="card-b flex flex-col">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 border-b border-[var(--border)] py-2.5 last:border-b-0"
          >
            <SkelBox size={26} radius={9} />
            <div className="flex flex-1 flex-col gap-1.5">
              <SkelLine w="45%" h={12} />
              <SkelLine w="70%" h={10} />
            </div>
            <SkelLine w="52px" h={16} />
          </div>
        ))}
      </div>
    </section>
  );
}
