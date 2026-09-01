-- ── מסעות לקוח ─────────────────────────────────────────────────────────────
--
-- כללי האוטומציה הקיימים הם חד-שלביים: תנאי אחד → שליחה אחת. מסע הוא רצף —
-- שלח, חכה יומיים, אם לא ענה שלח שוב, חכה שלושה, שלח מייל. זה מנוע חדש ולא
-- הרחבה של הקיים, ולכן טבלאות נפרדות; automation_rules נשארות כפי שהן.
--
-- ── מה קובע את היחידה: יום ──
-- הקרון ב-Vercel Hobby רץ פעם ביום. שלב "חכה שעתיים" היה נשמע אפשרי ומתבצע
-- למחרת, וזה גרוע מלא לאפשר אותו — לכן wait_days נמדד בימים, במפורש.
--
-- ── עקרון הבטיחות ──
-- זהה ל-automation_rule_runs: journey_step_runs נכתבת רק *אחרי* שליחה
-- מוצלחת. פונקציה שנקטעת באמצע לא משאירה מצב שבור — מי שלא הספיק יימצא שוב
-- בריצה הבאה, ומי שכן קיבל לא ייבחר שוב.

drop table if exists journey_step_runs cascade;
drop table if exists journey_enrollments cascade;
drop table if exists journey_steps cascade;
drop table if exists journeys cascade;

-- ── journeys ───────────────────────────────────────────────────────────────
create table journeys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- מה מכניס איש קשר למסע. כולם ניתנים לזיהוי בשאילתה מהקרון, בלי קריאות
  -- מפוזרות מכל מקום שכותב נתונים — אותה גישה שנקט המנוע הקיים.
  --   status      — נמצא כרגע בסטטוס מסוים (entry_value: {"status": "..."})
  --   quiz        — מילא את השאלון
  --   booking     — קבע פגישה
  --   course_lead — השאיר פרטים בדף הנחיתה של הקורס
  entry_type text not null
    check (entry_type in ('status', 'quiz', 'booking', 'course_lead')),
  entry_value jsonb not null default '{}'::jsonb,

  -- כבוי כברירת מחדל. מסע שנדלק בטעות באמצע עריכה שולח הודעות אמיתיות
  -- ללקוחות אמיתיים, ואי אפשר לבטל אותן.
  active boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger journeys_set_updated_at
  before update on journeys
  for each row execute function public.set_updated_at();

-- ── journey_steps ──────────────────────────────────────────────────────────
create table journey_steps (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys (id) on delete cascade,

  position int not null,

  -- כמה ימים להמתין *לפני* השלב הזה. 0 בשלב הראשון = מיד עם הכניסה.
  wait_days int not null default 0 check (wait_days >= 0 and wait_days <= 365),

  channel message_channel not null,

  -- restrict ולא cascade: מחיקת תבנית שמסע מצביע עליה הייתה משאירה שלב בלי
  -- תוכן, וזו שגיאה שמתגלה רק כשהקרון מגיע אליו.
  template_id uuid not null references message_templates (id) on delete restrict,

  -- הרציונל של מעקב: אם הלקוח ענה בינתיים, אין טעם להמשיך לרדוף אחריו.
  stop_if_replied boolean not null default true,

  created_at timestamptz not null default now(),

  unique (journey_id, position)
);

create index journey_steps_journey_idx on journey_steps (journey_id, position);

-- ── journey_enrollments ────────────────────────────────────────────────────
-- איפה כל איש קשר עומד. שורה אחת לכל צירוף מסע+לקוח, לכל החיים — ה-unique
-- הוא מה שמונע צירוף חוזר של מי שכבר עבר את המסע.
create table journey_enrollments (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references journeys (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,

  next_position int not null default 1,
  next_run_at timestamptz not null default now(),

  --   active           — ממתין לשלב הבא
  --   completed        — סיים את כל השלבים
  --   stopped_replied  — הלקוח ענה, והמסע נעצר מרצון
  --   stopped_manual   — נעצר מהדשבורד
  state text not null default 'active'
    check (state in ('active', 'completed', 'stopped_replied', 'stopped_manual')),

  enrolled_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (journey_id, contact_id)
);

create index journey_enrollments_due_idx
  on journey_enrollments (next_run_at) where state = 'active';
create index journey_enrollments_contact_idx on journey_enrollments (contact_id);

create trigger journey_enrollments_set_updated_at
  before update on journey_enrollments
  for each row execute function public.set_updated_at();

-- ── journey_step_runs ──────────────────────────────────────────────────────
-- נכתבת רק אחרי שליחה מוצלחת. זה מה שהופך קטיעה באמצע ריצה לבטוחה.
create table journey_step_runs (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references journey_enrollments (id) on delete cascade,
  step_id uuid not null references journey_steps (id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table journeys            enable row level security;
alter table journey_steps       enable row level security;
alter table journey_enrollments enable row level security;
alter table journey_step_runs   enable row level security;

create policy "team reads journeys"    on journeys            for select to authenticated using (true);
create policy "team writes journeys"   on journeys            for all    to authenticated using (true) with check (true);
create policy "team reads steps"       on journey_steps       for select to authenticated using (true);
create policy "team writes steps"      on journey_steps       for all    to authenticated using (true) with check (true);
create policy "team reads enrollments" on journey_enrollments for select to authenticated using (true);
create policy "team writes enrollments" on journey_enrollments for all   to authenticated using (true) with check (true);
create policy "team reads step runs"   on journey_step_runs   for select to authenticated using (true);
create policy "team writes step runs"  on journey_step_runs   for all    to authenticated using (true) with check (true);
