import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { CONTACT_PLACEHOLDERS, BOOKING_PLACEHOLDERS } from "@/lib/templates";
import { splitVariants } from "@/lib/message-variants";
import { listTemplateBlockers, blockedExplanation } from "./blockers";
import { createTemplateAction, deleteTemplateAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * תבניות הודעה — וואטסאפ ומייל.
 *
 * עד 24.11.2026 תבנית וואטסאפ הייתה ישות של מטא: נוצרה שם, חיכתה לאישור
 * וסונכרנה לכאן. הוואטסאפ עבר לגשר הלא רשמי, שאין בו אישור — ולכן כל החלק
 * של מטא ירד מהמסך, ותבנית וואטסאפ היא טקסט רגיל כמו תבנית מייל.
 */

// נגזר מ-templates.ts ולא נכתב ביד: מציין שנוסף למנוע ולא לתווית הוא מציין
// שאיש לא ידע להשתמש בו.
const braced = (names: string[]) => names.map((n) => `{{${n}}}`).join(" ");
const PLACEHOLDER_HINT = `נתמכים: ${braced(CONTACT_PLACEHOLDERS)} · ופגישה: ${braced(
  BOOKING_PLACEHOLDERS
)}`;

export default async function TemplatesPage({
  searchParams,
}: {
  // blocked=<id> מגיע מניסיון מחיקה שנחסם. ראו deleteTemplateAction.
  searchParams: Promise<{ blocked?: string }>;
}) {
  await verifyTeamMember();

  const [{ data: templates, error }, blockers, { blocked }] = await Promise.all([
    supabaseAdmin()
      .from("message_templates")
      .select("*")
      .order("created_at", { ascending: false }),
    listTemplateBlockers(),
    searchParams,
  ]);
  if (error) throw error;

  const blockedTemplate = blocked ? templates?.find((t) => t.id === blocked) : undefined;
  const blockedHolders = blocked ? blockers.get(blocked) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="h-page">
        <div>
          <h1>תבניות הודעה</h1>
          <p>נוסחים שמורים לוואטסאפ ולמייל — לשימוש במסעות, בכללים, בתזכורות ובכרטיס איש הקשר.</p>
        </div>
      </div>

      {blockedTemplate && blockedHolders && (
        <div className="card border-[var(--danger)]/30 bg-[var(--danger-soft)] text-sm leading-relaxed text-[var(--danger)]">
          <strong>{blockedExplanation(blockedTemplate.name, blockedHolders)}</strong>
          <p className="mt-1">
            מחיקה הייתה משאירה שם שלב בלי תוכן, ותקלה כזו מתגלה רק כשהמערכת מגיעה
            לשלוח — כלומר על לקוח אמיתי. הסירו את התבנית משם קודם, ואז המחיקה תעבוד.
          </p>
        </div>
      )}

      <section className="card">
        <h2 className="card-title">תבנית חדשה</h2>
        <form action={createTemplateAction} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="field-label">
            שם התבנית
            <input name="name" required className="input" placeholder="תזכורת ערב לפני" />
          </label>
          <label className="field-label">
            ערוץ
            <select name="channel" className="input" defaultValue="whatsapp">
              <option value="whatsapp">וואטסאפ</option>
              <option value="email">מייל</option>
            </select>
          </label>
          <label className="field-label">
            כותרת המייל
            <input name="subject" className="input" placeholder="למייל בלבד" />
          </label>
          <label className="field-label md:col-span-3">
            תוכן
            <textarea
              name="body"
              required
              rows={6}
              className="input"
              placeholder={"היי {{first_name}}, רציתי לבדוק איך היה התרגול?\n---\n{{first_name}}, מה שלומך? איך הולך עם התרגול?"}
            />
            <span className="text-xs leading-relaxed font-normal text-[var(--subtle)]">
              {PLACEHOLDER_HINT}
            </span>
            <span className="text-xs leading-relaxed font-normal text-[var(--subtle)]">
              <strong className="font-semibold text-[var(--muted)]">בוואטסאפ, כדאי לכתוב 2–3 גרסאות</strong>{" "}
              לאותה הודעה, ובין גרסה לגרסה שורה עם שלושה מקפים (---). בכל שליחה תיבחר אחת
              באקראי, כך שלא ייצאו עשרות הודעות זהות — זה מה שוואטסאפ מזהה כבוט.
            </span>
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-3">
            צור תבנית
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        {templates?.map((t) => {
          const holders = blockers.get(t.id);
          return (
            <div key={t.id} className="card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                    {t.channel === "email" ? "מייל" : "וואטסאפ"}
                  </span>
                </div>
                {holders ? (
                  <span className="text-xs font-medium text-[var(--subtle)]">
                    בשימוש — לא ניתן למחוק
                  </span>
                ) : (
                  <form action={deleteTemplateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="btn-danger">
                      מחיקה
                    </button>
                  </form>
                )}
              </div>
              {holders && (
                <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                  בשימוש: {holders.join(", ")}. כדי למחוק אותה, הסירו אותה משם קודם.
                </p>
              )}
              {t.subject && (
                <p className="mt-2 text-sm text-[var(--muted)]">כותרת: {t.subject}</p>
              )}
              <p className="mt-1 text-sm whitespace-pre-wrap">{t.body}</p>
              {t.channel === "whatsapp" && splitVariants(t.body).length > 1 && (
                <p className="mt-2 text-xs text-[var(--subtle)]">
                  {splitVariants(t.body).length} גרסאות — בכל שליחה נבחרת אחת באקראי.
                </p>
              )}
            </div>
          );
        })}
        {!templates?.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין תבניות</p>
        )}
      </section>
    </div>
  );
}
