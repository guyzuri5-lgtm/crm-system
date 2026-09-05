import { formatDateTime } from "@/lib/dates";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import {
  META_TEMPLATE_CATEGORIES,
  isTemplateManagementConfigured,
} from "@/lib/whatsapp-cloud";
import { CONTACT_PLACEHOLDERS, BOOKING_PLACEHOLDERS } from "@/lib/templates";
import { listTemplateBlockers, blockedExplanation } from "./blockers";
import {
  createTemplateAction,
  deleteTemplateAction,
  syncMetaTemplatesAction,
  createMetaTemplateAction,
  deleteFromMetaAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * הסטטוס שמגיע מ-Meta, בשפה שאומרת מה לעשות איתו.
 *
 * MISSING אינו סטטוס של Meta אלא שלנו: הרשומה מצביעה על שם שלא נמצא בסנכרון
 * האחרון. זו התקלה הכי מסוכנת כאן, כי בלי הסימון הזה היא מתגלה רק כששליחה
 * נכשלת — על לקוח אמיתי, ובשקט.
 */
const META_STATUS = {
  APPROVED: { text: "מאושרת", tone: "ok" as const, hint: null },
  PENDING: {
    text: "ממתינה לאישור",
    tone: "warn" as const,
    hint: "Meta עדיין בודקת. עד האישור אי אפשר לשלוח אותה מחוץ לחלון.",
  },
  REJECTED: {
    text: "נדחתה",
    tone: "bad" as const,
    hint: "צריך לתקן את הנוסח וליצור תבנית חדשה. Meta אינה מאפשרת לערוך תבנית שנדחתה.",
  },
  PAUSED: {
    text: "מושהית",
    tone: "bad" as const,
    hint: "Meta השהתה אותה בגלל איכות ירודה — נמענים סימנו אותה כספאם.",
  },
  DISABLED: { text: "מושבתת", tone: "bad" as const, hint: "Meta השביתה אותה לצמיתות." },
  MISSING: {
    text: "לא נמצאה ב-Meta",
    tone: "bad" as const,
    hint: "הרשומה מצביעה על שם שלא קיים. כל שליחה מחוץ לחלון שתשתמש בה תיכשל.",
  },
};

// נגזר מ-templates.ts ולא נכתב ביד: מציין שנוסף למנוע ולא לתווית הוא מציין
// שאיש לא ידע להשתמש בו.
const braced = (names: string[]) => names.map((n) => `{{${n}}}`).join(" ");
const PLACEHOLDER_HINT = `תוכן — נתמכים: ${braced(CONTACT_PLACEHOLDERS)} · ופגישה: ${braced(
  BOOKING_PLACEHOLDERS
)}`;

const TONE_CLASSES = {
  ok: "bg-[var(--ok-soft)] text-[var(--ok)] ring-[var(--ok)]/25",
  warn: "bg-[var(--warn-soft)] text-[var(--warn)] ring-[var(--warn)]/25",
  bad: "bg-[var(--danger-soft)] text-[var(--danger)] ring-[var(--danger)]/25",
};

export default async function TemplatesPage({
  searchParams,
}: {
  // blocked=<id> מגיע מניסיון מחיקה שנחסם. ראו deleteTemplateAction.
  searchParams: Promise<{ blocked?: string }>;
}) {
  await verifyTeamMember();
  const canManage = isTemplateManagementConfigured();

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">תבניות הודעה</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            תבנית שנדחתה או נמחקה אצל Meta ממשיכה להיראות תקינה כאן עד שמסנכרנים.
            {templates?.some((t) => t.meta_synced_at) && (
              <> סונכרן לאחרונה: {formatDateTime(
                templates.reduce(
                  (max, t) => (t.meta_synced_at && t.meta_synced_at > max ? t.meta_synced_at : max),
                  ""
                )
              )}.</>
            )}
          </p>
        </div>
        {canManage && (
          <form action={syncMetaTemplatesAction}>
            <button type="submit" className="btn-ghost">
              סנכרן מ-Meta
            </button>
          </form>
        )}
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

      {!canManage && (
        <div className="card border-[var(--warn)]/30 bg-[var(--warn-soft)] text-sm text-[var(--warn)]">
          <strong>ניהול תבניות מול Meta כבוי.</strong> חסר{" "}
          <code dir="ltr">WHATSAPP_WABA_ID</code> — בלעדיו אפשר רק לרשום ידנית שם של
          תבנית שנוצרה בממשק של Meta, ואי אפשר לדעת אם היא עדיין מאושרת.
        </div>
      )}

      {canManage && (
        <section className="card">
          <h2 className="card-title">תבנית חדשה ב-Meta</h2>
          <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--muted)]">
            יוצר את התבנית אצל Meta ורושם אותה כאן, בפעולה אחת. כותבים את הנוסח פעם
            אחת עם המציינים הרגילים — Meta מקבלת את הגרסה הממוספרת שלה אוטומטית,
            והסדר נשמר. האישור לוקח בין דקות לשעות.
          </p>

          <form action={createMetaTemplateAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="field-label">
              שם פנימי
              <input name="name" required className="input" placeholder="תזכורת לפגישה" />
              <span className="text-xs font-normal text-[var(--subtle)]">
                מה שתראו בדשבורד. בעברית, כרצונכם.
              </span>
            </label>

            <label className="field-label">
              שם ב-Meta
              <input
                name="meta_template_name"
                required
                className="input"
                dir="ltr"
                pattern="[a-z0-9_]+"
                placeholder="appointment_reminder_he"
              />
              <span className="text-xs font-normal text-[var(--subtle)]">
                אותיות אנגליות קטנות, ספרות וקו תחתון. לא ניתן לשינוי אחר כך.
              </span>
            </label>

            <label className="field-label">
              קטגוריה
              <select name="category" className="input" required defaultValue="UTILITY">
                {META_TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c === "UTILITY" ? "Utility — תזכורת או עדכון" : "Marketing — פנייה יזומה"}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-[var(--subtle)]">
                Utility זולה משמעותית, אבל Meta מסווגת בעצמה: מעקב אחרי מי שלא ענה
                ייחשב Marketing גם אם תבקשו אחרת.
              </span>
            </label>

            <label className="field-label">
              שפה
              <input
                name="meta_language_code"
                defaultValue="he"
                className="input"
                dir="ltr"
                required
              />
            </label>

            <label className="field-label md:col-span-2">
              {PLACEHOLDER_HINT}
              <textarea
                name="body"
                required
                rows={3}
                className="input"
                placeholder={"היי {{first_name}}, תזכורת לגבי הפגישה שקבענו."}
              />
              <span className="text-xs font-normal text-[var(--subtle)]">
                כל מציין יהפוך אצל Meta למשתנה ממוספר, לפי סדר הופעתו כאן. מציני
                פגישה מתמלאים כששולחים ממסע או בכפתור הידני בכרטיס איש הקשר —
                בכלל אוטומציה אין פגישה בהקשר, והמציין ייצא ללקוח כפי שהוא.
              </span>
            </label>

            <button type="submit" className="btn-primary self-start md:col-span-2">
              צור ושלח לאישור Meta
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">תבנית מייל חדשה</h2>
        <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--muted)]">
          נוסח שמור למייל — לשימוש במסעות, בכללי אוטומציה ובשליחה מכרטיס איש קשר.
          לוואטסאפ אין כאן תבנית בכוונה: בתוך חלון 24 השעות כותבים לו ישירות בכרטיס
          איש הקשר, ומחוץ לחלון מותרת רק תבנית שאושרה ב-Meta — זו שנוצרת למעלה.
        </p>
        <form action={createTemplateAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            שם התבנית
            <input name="name" required className="input" />
          </label>
          <label className="field-label">
            כותרת המייל
            <input name="subject" className="input" />
          </label>
          <label className="field-label md:col-span-2">
            {PLACEHOLDER_HINT}
            <textarea name="body" required rows={4} className="input" />
          </label>

          <button type="submit" className="btn-primary self-start md:col-span-2">
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
              {t.channel === "whatsapp" && (
                <div className="mt-3 flex flex-col gap-2">
                  {t.meta_template_name ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const meta = t.meta_status
                            ? META_STATUS[t.meta_status as keyof typeof META_STATUS]
                            : null;
                          return meta ? (
                            <span
                              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[meta.tone]}`}
                            >
                              {meta.text}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] px-3 py-1 text-xs font-semibold text-[var(--muted)] ring-1 ring-inset ring-[var(--border)]">
                              טרם סונכרן
                            </span>
                          );
                        })()}
                        <span dir="ltr" className="text-xs font-medium text-[var(--subtle)]">
                          {t.meta_template_name} ({t.meta_language_code})
                        </span>
                        {t.meta_category && (
                          <span className="text-xs text-[var(--subtle)]">{t.meta_category}</span>
                        )}
                        {t.meta_variables.length > 0 && (
                          <span className="text-xs text-[var(--subtle)]">
                            {t.meta_variables.length} משתנים
                          </span>
                        )}
                      </div>

                      {(() => {
                        const meta = t.meta_status
                          ? META_STATUS[t.meta_status as keyof typeof META_STATUS]
                          : null;
                        if (!meta?.hint) return null;
                        return (
                          <p className="text-xs leading-relaxed text-[var(--muted)]">
                            {meta.hint}
                            {t.meta_rejected_reason && (
                              <> הסיבה שהחזירה Meta: <code dir="ltr">{t.meta_rejected_reason}</code>.</>
                            )}
                          </p>
                        );
                      })()}

                      {canManage && (
                        <form action={deleteFromMetaAction} className="self-start">
                          <input type="hidden" name="id" value={t.id} />
                          <button type="submit" className="text-xs text-[var(--danger)] hover:underline">
                            מחק את התבנית ב-Meta
                          </button>
                        </form>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-[var(--subtle)]">
                      ללא תבנית מאושרת — שמישה רק בתוך חלון 24 השעות
                    </p>
                  )}
                </div>
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
