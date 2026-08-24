-- שאלון הצ'אקרות → CRM
--
-- מוסיף טבלה אחת, quiz_submissions, ומחבר אותה ל-contacts הקיימת.
-- הרצה: Supabase SQL editor, אחרי 0001_init.sql.
--
-- למה טבלה נפרדת ולא עמודות על contacts:
--   רוב המילויים אנונימיים ולעולם לא יהפכו לאיש קשר, ואדם אחד יכול למלא
--   את השאלון יותר מפעם אחת. שורה לכל מילוי, עם קישור אופציונלי לאיש קשר.

-- ── Reset (בטוח להרצה חוזרת) ────────────────────────────────────────────
-- לא צריך "drop trigger" נפרד — הוא היה נכשל בריצה ראשונה (כשהטבלה עדיין
-- לא קיימת, "on quiz_submissions" לא נפתר, גם עם if exists על הטריגר).
-- ה-cascade כאן מוריד את הטריגר יחד עם הטבלה, כשהיא כן קיימת.
drop table if exists quiz_submissions cascade;

-- סוג אינטראקציה חדש ליומן איש הקשר.
-- ב-PG12+ מותר בתוך טרנזקציה כל עוד לא משתמשים בערך באותה טרנזקציה — וכאן
-- רק מוסיפים אותו; השימוש בפועל קורה בזמן ריצה, הרבה אחרי ה-commit.
alter type interaction_type add value if not exists 'quiz_submitted';

-- ── quiz_submissions ────────────────────────────────────────────────────
create table quiz_submissions (
  id uuid primary key default gen_random_uuid(),

  -- מזהה שנוצר בדפדפן בתחילת המילוי. אותו מזהה נשלח גם ב-utm_content
  -- לקלנדלי, וכך אפשר לקשר פגישה שנקבעה לתוצאה המלאה.
  session_id text not null unique,

  -- מתמלא רק כשהמשתמש משאיר פרטים. אנונימי נשאר null.
  contact_id uuid references contacts (id) on delete set null,

  -- anonymous → סיים את השאלון | lead → השאיר פרטים | booking_click → יצא ליומן
  kind text not null default 'anonymous'
    check (kind in ('anonymous', 'lead', 'booking_click')),

  full_name text,
  email     text,
  phone     text,
  consent   boolean not null default false,

  lowest_chakra      text,   -- המפתח באנגלית: throat, heart …
  lowest_chakra_name text,   -- השם בעברית, לתצוגה

  scores   jsonb not null default '{}'::jsonb,  -- {"root":67,"sacral":56,…}
  statuses jsonb not null default '{}'::jsonb,  -- {"root":"balanced",…}
  answers  jsonb not null default '[]'::jsonb,  -- [{id,chakra,text,score}, …]

  balance_index   integer,
  balance_display integer,
  mean_score      integer,
  spread          integer,

  source text,
  utm    jsonb not null default '{}'::jsonb,

  booking_clicked_at timestamptz,

  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index quiz_submissions_contact_id_idx  on quiz_submissions (contact_id);
create index quiz_submissions_submitted_at_idx on quiz_submissions (submitted_at desc);
create index quiz_submissions_email_idx        on quiz_submissions (lower(email));
create index quiz_submissions_lowest_idx       on quiz_submissions (lowest_chakra);

create trigger quiz_submissions_set_updated_at
  before update on quiz_submissions
  for each row execute function public.set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
-- כמו שאר הטבלאות: האפליקציה ניגשת עם service role שעוקף RLS, והמדיניות
-- כאן היא קו הגנה שני. שים לב: אין כאן policy ל-anon — הכתיבה מהשאלון
-- עוברת דרך /api/webhooks/quiz בצד השרת, לא ישירות מהדפדפן.
alter table quiz_submissions enable row level security;

create policy "team can read quiz_submissions"
  on quiz_submissions for select to authenticated using (true);
create policy "team can write quiz_submissions"
  on quiz_submissions for all to authenticated using (true) with check (true);
