import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { MESSAGE_CHANNELS } from "@/lib/supabase/database.types";
import {
  META_TEMPLATE_CATEGORIES,
  isTemplateManagementConfigured,
} from "@/lib/whatsapp-cloud";
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

const TONE_CLASSES = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-600/20",
  bad: "bg-red-50 text-[var(--danger)] ring-red-600/20",
};

export default async function TemplatesPage() {
  await verifyTeamMember();
  const canManage = isTemplateManagementConfigured();

  const { data: templates, error } = await supabaseAdmin()
    .from("message_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">תבניות הודעה</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            תבנית שנדחתה או נמחקה אצל Meta ממשיכה להיראות תקינה כאן עד שמסנכרנים.
            {templates?.some((t) => t.meta_synced_at) && (
              <> סונכרן לאחרונה: {new Date(
                templates.reduce(
                  (max, t) => (t.meta_synced_at && t.meta_synced_at > max ? t.meta_synced_at : max),
                  ""
                )
              ).toLocaleString("he-IL")}.</>
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

      {!canManage && (
        <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">
          <strong>ניהול תבניות מול Meta כבוי.</strong> חסר{" "}
          <code dir="ltr">WHATSAPP_WABA_ID</code> — בלעדיו אפשר רק לרשום ידנית שם של
          תבנית שנוצרה בממשק של Meta, ואי אפשר לדעת אם היא עדיין מאושרת.
        </div>
      )}

      {canManage && (
        <section className="card">
          <h2 className="font-medium">תבנית חדשה ב-Meta</h2>
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
              {"תוכן — נתמכים: {{first_name}} {{full_name}} {{phone}} {{email}} {{status}}"}
              <textarea
                name="body"
                required
                rows={3}
                className="input"
                placeholder={"היי {{first_name}}, תזכורת לגבי הפגישה שקבענו."}
              />
              <span className="text-xs font-normal text-[var(--subtle)]">
                כל מציין יהפוך אצל Meta למשתנה ממוספר, לפי סדר הופעתו כאן.
              </span>
            </label>

            <button type="submit" className="btn-primary self-start md:col-span-2">
              צור ושלח לאישור Meta
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h2 className="mb-4 font-medium">תבנית חדשה</h2>
        <form action={createTemplateAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="field-label">
            ערוץ
            <select name="channel" className="input" required>
              {MESSAGE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c === "email" ? "מייל" : "וואטסאפ"}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            שם התבנית
            <input name="name" required className="input" />
          </label>
          <label className="field-label md:col-span-2">
            כותרת (למייל בלבד)
            <input name="subject" className="input" />
          </label>
          <label className="field-label md:col-span-2">
            {"תוכן — נתמכים: {{full_name}} {{first_name}} {{phone}} {{email}} {{status}} · ופגישה: {{booking_date}} {{booking_time}} {{booking_day}} {{booking_datetime}} {{booking_link}}"}
            <textarea name="body" required rows={4} className="input" />
          </label>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 md:col-span-2">
            <p className="text-sm font-medium">שליחה מחוץ לחלון 24 השעות (וואטסאפ בלבד)</p>
            <p className="mt-1 mb-4 text-xs leading-relaxed text-[var(--muted)]">
              ללקוח שלא כתב לנו ב-24 השעות האחרונות אפשר לשלוח רק תבנית שאושרה מראש
              אצל Meta. השדות כאן מקשרים את התבנית הזו לתבנית המאושרת שם. משאירים ריק
              כשהתבנית מיועדת לשימוש בתוך החלון בלבד.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="field-label">
                שם התבנית ב-Meta
                <input
                  name="meta_template_name"
                  className="input"
                  dir="ltr"
                  placeholder="appointment_reminder"
                  pattern="[a-z0-9_]+"
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  בדיוק כפי שהיא מופיעה ב-Meta: אותיות קטנות, ספרות וקו תחתון.
                </span>
              </label>

              <label className="field-label">
                שפת התבנית
                <input
                  name="meta_language_code"
                  defaultValue="he"
                  className="input"
                  dir="ltr"
                  placeholder="he"
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  חייב להתאים לשפה שאיתה אושרה. תבנית שאושרה ב-he ונשלחת כ-en_US נדחית.
                </span>
              </label>

              <label className="field-label md:col-span-2">
                {"מה ממלא את {{1}}, {{2}} ... — שורה לכל אחד, לפי הסדר"}
                <textarea
                  name="meta_variables"
                  rows={3}
                  className="input"
                  dir="ltr"
                  placeholder={"{{first_name}}\n{{status}}"}
                />
                <span className="text-xs font-normal text-[var(--subtle)]">
                  {"אותם מציינים של התוכן למעלה. השורה הראשונה ממלאת את {{1}}, השנייה את {{2}}."}
                </span>
              </label>
            </div>
          </div>

          <button type="submit" className="btn-primary self-start md:col-span-2">
            צור תבנית
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        {templates?.map((t) => (
          <div key={t.id} className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="rounded-full bg-[var(--background)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                  {t.channel === "email" ? "מייל" : "וואטסאפ"}
                </span>
              </div>
              <form action={deleteTemplateAction}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="btn-danger">
                  מחיקה
                </button>
              </form>
            </div>
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
                          <span className="inline-flex items-center gap-2 rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600 ring-1 ring-inset ring-stone-500/15">
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
        ))}
        {!templates?.length && (
          <p className="px-1 text-sm text-[var(--subtle)]">עדיין אין תבניות</p>
        )}
      </section>
    </div>
  );
}
