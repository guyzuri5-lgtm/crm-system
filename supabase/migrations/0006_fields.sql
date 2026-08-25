-- שדות אנשי קשר הניתנים להגדרה
--
-- הרצה: Supabase SQL editor, אחרי 0001–0005.
--
-- שתי מטרות:
--   1. שדות מותאמים חדשים ("עיר", "איך שמע עלינו") בלי מיגרציה לכל שדה —
--      ההגדרה יושבת ב-contact_fields והערך ב-contacts.custom (jsonb).
--   2. שליטה בתצוגה: אילו שדות מופיעים בטבלת אנשי הקשר ובאיזה סדר.
--
-- למה key נפרד מ-label: ה-key הוא המפתח בתוך ה-jsonb ולכן הוא לנצח — שינוי
-- שם תצוגה של שדה לא אמור לדרוש מעבר על כל אנשי הקשר וכתיבה מחדש של המפתח
-- בכל שורה. ה-key נוצר פעם אחת ('f_' + אקראי) ואף פעם לא משתנה; label חופשי.

-- ── Reset (בטוח להרצה חוזרת) ────────────────────────────────────────────
drop table if exists contact_fields cascade;

-- ── contact_fields ──────────────────────────────────────────────────────
create table contact_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,

  -- builtin = עמודה אמיתית ב-contacts (full_name, phone, ...). אי אפשר למחוק
  -- אותם: מנוע האוטומציה, ה-webhooks ותבניות ההודעה נשענים עליהם בשמם.
  -- custom  = חי בתוך contacts.custom לפי ה-key.
  kind text not null check (kind in ('builtin', 'custom')),

  input_type text not null default 'text'
    check (input_type in ('text', 'longtext', 'number', 'date', 'email', 'phone', 'url')),

  sort_order integer not null default 0,
  show_in_table boolean not null default true,

  -- false = תצוגה בלבד; לא ניתן לעריכה ידנית ולא יעד חוקי לייבוא.
  editable boolean not null default true,

  created_at timestamptz not null default now()
);

create index contact_fields_sort_idx on contact_fields (sort_order, created_at);

-- זריעת השדות המובנים, בסדר שבו הטבלה הציגה אותם עד היום.
insert into contact_fields (key, label, kind, input_type, sort_order, show_in_table, editable) values
  ('full_name',  'שם',     'builtin', 'text',  10, true,  true),
  ('phone',      'טלפון',  'builtin', 'phone', 20, true,  true),
  ('email',      'מייל',   'builtin', 'email', 30, true,  true),
  ('status',     'סטטוס',  'builtin', 'text',  40, true,  true),
  ('tags',       'תגיות',  'builtin', 'text',  50, true,  true),
  ('source',     'מקור',   'builtin', 'text',  60, true,  true),
  ('notes',      'הערות',  'builtin', 'longtext', 70, false, true),
  ('created_at', 'נוצר',   'builtin', 'date',  80, true,  false);

-- ── contacts.custom ─────────────────────────────────────────────────────
-- ערכי השדות המותאמים. תמיד אובייקט, אף פעם לא null, כדי שקוד קורא לא יצטרך
-- לטפל בשני מצבים ריקים שונים.
alter table contacts add column if not exists custom jsonb not null default '{}'::jsonb;

alter table contacts drop constraint if exists contacts_custom_is_object;
alter table contacts add constraint contacts_custom_is_object
  check (jsonb_typeof(custom) = 'object');

-- GIN לחיפוש/סינון עתידי לפי ערך בשדה מותאם.
create index if not exists contacts_custom_idx on contacts using gin (custom);

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table contact_fields enable row level security;

create policy "team can read contact_fields" on contact_fields for select to authenticated using (true);
create policy "team can write contact_fields" on contact_fields for all to authenticated using (true) with check (true);
