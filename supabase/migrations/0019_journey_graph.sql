-- ── ממסע-טור למסע-גרף ──────────────────────────────────────────────────────
--
-- 0016–0018 בנו את המסע כטור: לכל שלב position, והמנוע חיפש את position+1.
-- זה כיסה "שלח, חכה, שלח שוב", וגם הסתעפות פשוטה — שני שלבים עוקבים עם
-- תנאים הפוכים. אבל הוא לא יכול לתאר שני מסלולים *שנפרדים באמת* ומתקדמים
-- כל אחד בקצב שלו, כי אחרי שלב אחד יכול לבוא רק שלב אחד.
--
-- ── מה משתנה, וזה השינוי היחיד שבאמת חשוב ──
-- התנאי עובר מהשלב אל הקשת. שלב אומר "שלח את זה"; הקשת אומרת "ולמי מותר
-- להמשיך לכאן". מרגע שהתנאי על הקשת, אפשר להוציא שתי קשתות מאותו שלב עם
-- תנאים שונים — וזו הסתעפות אמיתית.
--
-- ── הכניסה כצומת וירטואלי ──
-- קשת עם from_step_id ריק יוצאת מנקודת הכניסה למסע. כך "מה קורה ראשון" הוא
-- אותו מנגנון כמו "מה קורה אחרי שלב 3", ואין מקרה מיוחד למנוע.
--
-- אין מיגרציית נתונים: הטבלאות עדיין ריקות.

drop table if exists journey_edges cascade;

-- position ו-condition מפנים את מקומם. שניהם ניסו לתאר מבנה שהיה טור בלבד.
alter table journey_steps drop column if exists position;
alter table journey_steps drop column if exists condition;

-- מיקום הכרטיסייה על המשטח. נשמר כדי שהתרשים ייראה בפעם הבאה כמו שסידרת
-- אותו — פריסה אוטומטית מסדרת יפה, אבל מוחקת את המשמעות שאתה נתת למרחב.
alter table journey_steps add column if not exists pos_x int not null default 0;
alter table journey_steps add column if not exists pos_y int not null default 0;

-- שם קצר לכרטיסייה. בלעדיו הכרטיסייה מציגה את שם התבנית, ובגרף עם כמה
-- מסלולים אותה תבנית יכולה להופיע פעמיים ואי אפשר להבדיל.
alter table journey_steps add column if not exists label text;

-- ── journey_edges ──────────────────────────────────────────────────────────
create table journey_edges (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys (id) on delete cascade,

  -- ריק = יוצאת מנקודת הכניסה למסע.
  from_step_id uuid references journey_steps (id) on delete cascade,
  to_step_id   uuid not null references journey_steps (id) on delete cascade,

  condition text not null default 'always'
    check (condition in ('always', 'if_replied', 'if_not_replied')),

  -- כשיוצאות כמה קשתות מאותו צומת, זה סדר הבדיקה. הראשונה שתנאיה מתקיימים
  -- זוכה — ולכן קשת 'always' שיושבת ראשונה תבלע את כל השאר.
  priority int not null default 0,

  created_at timestamptz not null default now(),

  -- קשת מצומת לעצמו היא לולאה מיידית שהמנוע לא יוכל לצאת ממנה.
  check (from_step_id is null or from_step_id <> to_step_id)
);

create index journey_edges_from_idx on journey_edges (journey_id, from_step_id, priority);

-- ── journey_enrollments ────────────────────────────────────────────────────
-- המיקום כבר אינו מספר בטור אלא צומת בגרף.
alter table journey_enrollments drop column if exists next_position;
alter table journey_enrollments
  add column if not exists current_step_id uuid references journey_steps (id) on delete set null;

-- בגרף אפשר לכתוב מעגל, ובניגוד לטור אין בו סוף מובנה. המונה הזה הוא
-- החגורה: הוא נספר בכל שליחה, והמנוע עוצר בתקרה. בלעדיו מעגל היה שולח
-- ללקוח אחד הודעה בכל ריצה, לנצח.
alter table journey_enrollments
  add column if not exists steps_taken int not null default 0;

alter table journey_enrollments enable row level security;
alter table journey_edges enable row level security;

create policy "team reads edges" on journey_edges for select to authenticated using (true);
create policy "team writes edges" on journey_edges for all to authenticated using (true) with check (true);
