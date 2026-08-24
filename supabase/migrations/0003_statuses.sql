-- ניהול סטטוסים דינמי — הסטטוסים עוברים מ-enum לטבלה
--
-- הרצה: Supabase SQL editor, אחרי 0001_init.sql ו-0002_quiz.sql.
--
-- למה: contact_status היה טיפוס enum. פוסטגרס מאפשר להוסיף ערכים ל-enum
-- (alter type ... add value) אבל *לא* למחוק אותם, ואי אפשר להריץ את זה
-- מתוך האפליקציה בזמן ריצה. כדי שהצוות יוכל להוסיף ולמחוק סטטוסים מהדשבורד,
-- contacts.status הופך ל-text עם מפתח זר לטבלת contact_statuses.
--
-- ה-FK הוא על ה*שם* ולא על id, כדי שכל הקוד הקיים (‎.eq("status", "מתעניין")‎,
-- trigger_value של כללי אוטומציה, ‎{{status}}‎ בתבניות) ימשיך לעבוד כמו שהוא.
-- on update cascade → שינוי שם סטטוס מתגלגל לכל אנשי הקשר.
-- on delete restrict → אי אפשר למחוק סטטוס שעדיין בשימוש; המחיקה בדשבורד
-- מעבירה קודם את אנשי הקשר לסטטוס אחר ורק אז מוחקת.

-- ── Reset (בטוח להרצה חוזרת) ────────────────────────────────────────────
alter table contacts drop constraint if exists contacts_status_fkey;
drop trigger if exists contacts_fill_default_status on contacts;
drop function if exists public.contacts_fill_default_status();
drop table if exists contact_statuses cascade;

-- ── contact_statuses ────────────────────────────────────────────────────
create table contact_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- מפתח מתוך פלטה קבועה בקוד (src/lib/status-colors.ts). לא קוד צבע חופשי:
  -- Tailwind v4 סורק את קוד המקור ומייצר רק מחלקות שמופיעות בו ליטרלית,
  -- אז מחרוזת צבע שנוצרת בזמן ריצה פשוט לא תיטען.
  color text not null default 'stone'
    check (color in ('blue','amber','violet','emerald','stone','rose','sky','orange','lime','cyan','fuchsia','slate')),
  -- קובע גם את סדר התצוגה וגם מי סטטוס ברירת המחדל: הראשון ברשימה.
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index contact_statuses_sort_idx on contact_statuses (sort_order, created_at);

-- זריעה מהערכים שהיו ב-enum, באותו סדר ובאותם צבעים שה-StatusBadge נתן להם.
insert into contact_statuses (name, color, sort_order) values
  ('ליד_חדש',    'blue',    10),
  ('יצרנו_קשר',  'amber',   20),
  ('מתעניין',    'violet',  30),
  ('סגר_עסקה',   'emerald', 40),
  ('לא_רלוונטי', 'stone',   50);

-- ── contacts.status: enum → text ────────────────────────────────────────
-- ה-default חייב לרדת לפני שינוי הטיפוס (הוא מנוסח בטיפוס הישן), ואחריו הוא
-- לא חוזר כ-default של עמודה אלא כטריגר — ראו למטה.
alter table contacts alter column status drop default;
alter table contacts alter column status type text using status::text;

alter table contacts
  add constraint contacts_status_fkey
  foreign key (status) references contact_statuses (name)
  on update cascade on delete restrict;

-- ברירת מחדל דינמית: הסטטוס הראשון בסדר התצוגה. חייב להיות טריגר ולא
-- ‎default 'ליד_חדש'‎ — אחרת מחיקת הסטטוס הזה מהדשבורד הייתה משאירה ברירת
-- מחדל שמפרה את ה-FK, וכל insert מה-webhook של ManyChat היה נכשל.
-- BEFORE INSERT רץ לפני בדיקת ה-NOT NULL, אז עמודה שהושמטה מתמלאת בזמן.
create function public.contacts_fill_default_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status is null then
    select name into new.status from public.contact_statuses order by sort_order, created_at limit 1;
  end if;
  return new;
end;
$$;

create trigger contacts_fill_default_status
  before insert on contacts
  for each row execute function public.contacts_fill_default_status();

-- הטיפוס עצמו כבר לא בשימוש בשום עמודה.
drop type if exists contact_status;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- זהה לשאר הטבלאות: האפליקציה ניגשת עם service role (עוקף RLS), וזו שכבת
-- הגנה שנייה אם אי פעם ייעשה שימוש במפתח ה-anon מהדפדפן.
alter table contact_statuses enable row level security;

create policy "team can read contact_statuses" on contact_statuses for select to authenticated using (true);
create policy "team can write contact_statuses" on contact_statuses for all to authenticated using (true) with check (true);
