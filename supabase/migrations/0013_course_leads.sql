-- דף הנחיתה של קורס המדיטציה → CRM
--
-- מוסיף טבלה אחת, course_leads, ומחבר אותה ל-contacts הקיימת.
-- הרצה: Supabase SQL editor, אחרי 0012_contact_activity.sql.
--
-- למה טבלה נפרדת ולא עמודות על contacts:
--   אותה סיבה כמו ב-quiz_submissions — אדם אחד יכול להשאיר פרטים יותר
--   מפעם אחת, ואנחנו רוצים לשמור כל השארה בנפרד. אבל יש כאן סיבה שנייה
--   וכבדה יותר: הסכמה לדיוור שיווקי חייבת להישמר עם חותמת זמן משלה. אם
--   נחזיק אותה כשדה בוליאני על contacts, כל עדכון ידרוס את הראיה מתי
--   בדיוק ההסכמה ניתנה — וזו בדיוק הראיה שצריך להציג אם מישהו יטען
--   שנשלח אליו דיוור בלי שאישר.

-- ── Reset (בטוח להרצה חוזרת) ────────────────────────────────────────────
-- ה-cascade מוריד גם את הטריגר, בלי drop trigger נפרד שהיה נכשל בריצה
-- ראשונה (כשהטבלה עדיין לא קיימת).
drop table if exists course_leads cascade;

-- סוג אינטראקציה חדש ליומן איש הקשר.
-- ב-PG12+ מותר בתוך טרנזקציה כל עוד לא משתמשים בערך באותה טרנזקציה — וכאן
-- רק מוסיפים אותו; השימוש בפועל קורה בזמן ריצה, הרבה אחרי ה-commit.
alter type interaction_type add value if not exists 'course_lead';

-- ── course_leads ────────────────────────────────────────────────────────
create table course_leads (
  id uuid primary key default gen_random_uuid(),

  -- מזהה שנוצר בדפדפן כשנפתח הדף. מאפשר למזג את השארת הפרטים ואת
  -- הלחיצה על "מעבר לתשלום" לשורה אחת, במקום שתי רשומות מנותקות.
  session_id text not null unique,

  contact_id uuid references contacts (id) on delete set null,

  -- lead → השאיר פרטים | payment_click → יצא לעמוד התשלום
  kind text not null default 'lead'
    check (kind in ('lead', 'payment_click')),

  full_name text,
  email     text,
  phone     text,

  -- הסכמה לדיוור שיווקי. consent_at מתמלא רק כשההסכמה חיובית, והוא
  -- הראיה מתי היא ניתנה. מי שלא סימן — נשמר עם false, וזו רשומה
  -- לגיטימית: הוא רשאי לקנות בלי לאשר דיוור.
  consent    boolean not null default false,
  consent_at timestamptz,

  source text,
  utm    jsonb not null default '{}'::jsonb,

  payment_clicked_at timestamptz,

  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index course_leads_contact_id_idx   on course_leads (contact_id);
create index course_leads_submitted_at_idx on course_leads (submitted_at desc);
create index course_leads_email_idx        on course_leads (lower(email));
create index course_leads_consent_idx      on course_leads (consent) where consent;

create trigger course_leads_set_updated_at
  before update on course_leads
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
-- כמו שאר הטבלאות: האפליקציה ניגשת עם service role שעוקף RLS, והמדיניות
-- כאן היא קו הגנה שני. אין policy ל-anon — הכתיבה מדף הנחיתה עוברת דרך
-- /api/webhooks/course בצד השרת, לא ישירות מהדפדפן.
alter table course_leads enable row level security;

create policy "team can read course_leads"
  on course_leads for select to authenticated using (true);
create policy "team can write course_leads"
  on course_leads for all to authenticated using (true) with check (true);
