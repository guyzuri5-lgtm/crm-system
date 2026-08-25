-- מערכת זימון פגישות (סגנון Calendly) — סכמה
--
-- הרצה: Supabase SQL editor, אחרי 0001–0004.
--
-- הרעיון: "סוג פגישה" (booking_event_types) הוא היחידה שמקבלת קישור ציבורי
-- משלה — /book/<slug>. השעות שבהן אפשר להיפגש נשמרות פעם אחת כברירת מחדל
-- גלובלית (booking_availability עם event_type_id ריק) וכל סוג פגישה יכול
-- לדרוס אותן בשעות משלו. חסימות חד־פעמיות ("אני בחו"ל") הן טבלה נפרדת.
--
-- מה *לא* נשמר כאן: האירועים הקיימים ביומן גוגל. הם נשלפים בזמן אמת דרך
-- freeBusy בכל חישוב סלוטים, כי כל מנגנון סנכרון היה יכול להציג שעה פנויה
-- שכבר נתפסה ביומן. ה-DB מחזיק רק את מה שנקבע *דרך* המערכת הזו.

-- ── Reset (בטוח להרצה חוזרת) ────────────────────────────────────────────
drop table if exists bookings cascade;
drop table if exists booking_blackouts cascade;
drop table if exists booking_availability cascade;
drop table if exists booking_event_types cascade;
drop table if exists booking_settings cascade;
drop type if exists booking_location cascade;
drop type if exists booking_status cascade;

-- ── ערכי interaction_type חדשים ─────────────────────────────────────────
-- פוסטגרס לא מאפשר להסיר ערך מ-enum, ולכן זה לא חלק מבלוק ה-reset למעלה
-- ו-if not exists הוא מה שהופך את זה לבטוח בהרצה חוזרת. הערכים עצמם אינם
-- בשימוש בשום insert במיגרציה הזו — בכוונה: אי אפשר להשתמש בערך enum חדש
-- באותה טרנזקציה שבה הוא נוסף.
alter type interaction_type add value if not exists 'booking_created';
alter type interaction_type add value if not exists 'booking_cancelled';

-- ── Enums ────────────────────────────────────────────────────────────────
create type booking_location as enum ('google_meet', 'phone', 'in_person');
create type booking_status as enum ('confirmed', 'cancelled');

-- ── booking_settings (שורה אחת) ─────────────────────────────────────────
-- id boolean עם check(id) הוא הדרך הקצרה לאכוף "בדיוק שורה אחת": true הוא
-- הערך היחיד שעובר גם את ה-check וגם את מפתח היחידות.
create table booking_settings (
  id boolean primary key default true check (id),
  -- אזור הזמן שבו מנוסחות כל השעות בטבלת הזמינות, ושבו מוצגות השעות ללקוח.
  timezone text not null default 'Asia/Jerusalem',
  -- היומן שאליו נכתבות הפגישות. 'primary' = היומן הראשי של החשבון המחובר.
  calendar_id text not null default 'primary',
  -- יומנים *נוספים* שנלקחים בחשבון כ"תפוס" בחישוב הזמינות אבל לא נכתבים אליהם
  -- (יומן משפחתי, יומן של בן/בת זוג). calendar_id תמיד נבדק, גם בלי להופיע כאן.
  busy_calendar_ids text[] not null default '{}',
  -- שם התצוגה בכותרת דף ההזמנה ובמייל האישור.
  brand_name text not null default 'קביעת פגישה',
  updated_at timestamptz not null default now()
);

insert into booking_settings (id) values (true);

-- ── booking_event_types ─────────────────────────────────────────────────
create table booking_event_types (
  id uuid primary key default gen_random_uuid(),
  -- מה שמופיע בקישור: /book/<slug>. אותיות קטנות, ספרות ומקפים בלבד, כדי
  -- שהקישור יישאר קריא ולא ידרוש קידוד URL.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  duration_minutes integer not null default 30
    check (duration_minutes between 5 and 480),
  -- זמן מגן לפני/אחרי הפגישה. לא נכתב כאירוע ביומן — הוא רק מונע הצעת סלוט
  -- שנצמד לפגישה קיימת. כך "רבע שעה לנשום בין פגישות" לא דורש אירועי דמה.
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 240),
  buffer_after_minutes integer not null default 10 check (buffer_after_minutes between 0 and 240),
  -- כמה שעות מראש חייבים לקבוע. מונע פגישה שנקבעת עשר דקות לפני שהיא מתחילה.
  min_notice_hours integer not null default 4 check (min_notice_hours between 0 and 720),
  -- עד כמה ימים קדימה נפתח היומן להזמנות.
  max_days_ahead integer not null default 30 check (max_days_ahead between 1 and 365),
  -- הרזולוציה שבה מוצעות שעות התחלה: 15 => 9:00, 9:15, 9:30...
  -- לא חייב להתאים למשך הפגישה, וזה מה שמאפשר "פגישה של 45 דקות כל חצי שעה".
  slot_interval_minutes integer not null default 15
    check (slot_interval_minutes between 5 and 120),
  location booking_location not null default 'google_meet',
  -- כתובת/מספר טלפון להצגה כשה-location אינו google_meet.
  location_details text,
  -- אותה פלטה סגורה של הסטטוסים (src/lib/status-colors.ts) — ראו ההסבר שם
  -- למה זה לא קוד צבע חופשי.
  color text not null default 'blue'
    check (color in ('blue','amber','violet','emerald','stone','rose','sky','orange','lime','cyan','fuchsia','slate')),
  -- לאיזה סטטוס להעביר את איש הקשר כשנקבעת פגישה מהסוג הזה. ריק = לא לגעת.
  -- on delete set null: מחיקת סטטוס מהדשבורד לא תשבור את סוג הפגישה.
  set_contact_status text references contact_statuses (name)
    on update cascade on delete set null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_event_types_active_idx on booking_event_types (active, sort_order);

create trigger booking_event_types_set_updated_at
  before update on booking_event_types
  for each row execute function public.set_updated_at();

-- ── booking_availability (שעות שבועיות) ─────────────────────────────────
-- השעות נשמרות כדקות מחצות ולא כטיפוס time בכוונה: הן שעות *קיר* באזור הזמן
-- שב-booking_settings, לא רגעים בציר הזמן, והמרה שלהן ל-UTC חייבת לקרות לכל
-- תאריך בנפרד (שעון קיץ). מספר שלם עובר בין פוסטגרס ל-JS בלי פרסור ובלי
-- שאף שכבה באמצע תתפתה לצרף לו אזור זמן.
create table booking_availability (
  id uuid primary key default gen_random_uuid(),
  -- ריק = ברירת המחדל הגלובלית. שורות עם event_type_id דורסות אותה לחלוטין
  -- עבור אותו סוג פגישה (ולא מתווספות אליה) — ראו resolveAvailability בקוד.
  event_type_id uuid references booking_event_types (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = ראשון, כמו Date#getDay
  start_minute integer not null check (start_minute between 0 and 1440),
  end_minute integer not null check (end_minute between 0 and 1440),
  check (end_minute > start_minute)
);

create index booking_availability_lookup_idx on booking_availability (event_type_id, weekday);

-- ── booking_blackouts (חסימות ידניות חד־פעמיות) ─────────────────────────
create table booking_blackouts (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index booking_blackouts_range_idx on booking_blackouts (starts_at, ends_at);

-- ── bookings ────────────────────────────────────────────────────────────
create table bookings (
  id uuid primary key default gen_random_uuid(),
  -- restrict ולא cascade: מחיקת סוג פגישה לא תמחק פגישות שכבר נקבעו.
  -- כדי "להוריד" סוג פגישה מהאוויר יש לכבות את active.
  event_type_id uuid not null references booking_event_types (id) on delete restrict,
  -- set null ולא cascade: מחיקת כרטיס לקוח לא מוחקת את ההיסטוריה של הפגישה.
  contact_id uuid references contacts (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status booking_status not null default 'confirmed',
  invitee_name text not null,
  invitee_email text not null,
  invitee_phone text,
  invitee_notes text,
  -- אזור הזמן שבו הלקוח ראה את השעה כשקבע, לצורך הצגה נכונה במייל ובדשבורד.
  invitee_timezone text not null default 'Asia/Jerusalem',
  google_event_id text,
  google_meet_url text,
  -- הסוד שבקישור הביטול שנשלח במייל. הלקוח אינו מזוהה במערכת ואין לו סשן,
  -- אז הטוקן הוא ההרשאה היחידה לבטל — ולכן הוא אקראי וארוך, לא ה-id.
  cancel_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('invitee', 'team')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index bookings_starts_at_idx on bookings (starts_at desc);
create index bookings_contact_idx on bookings (contact_id, starts_at desc);

-- קו ההגנה האחרון מפני קביעה כפולה. חישוב הסלוטים כבר מסנן שעות תפוסות, אבל
-- בין החישוב לשמירה יש חלון של כמה שניות שבו שני אנשים יכולים לשלוח את אותה
-- שעה. אילוץ ההדרה נבדק אטומית בזמן ה-insert, כך שהשני מקבל שגיאה במקום
-- פגישה חופפת. חל רק על פגישות פעילות — פגישה שבוטלה מפנה את השעה.
--
-- הערה: האילוץ מכסה את זמן הפגישה בלבד ולא את הבאפרים שסביבה. הבאפרים
-- נאכפים בחישוב הסלוטים; כאן מדובר במרוץ נדיר, וחפיפה ממשית היא מה שחייב
-- להיחסם ברמת ה-DB.
alter table bookings
  add constraint bookings_no_overlap
  exclude using gist (tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed');

-- ── זריעה: סוג פגישה אחד ושבוע עבודה, כדי שהמערכת עובדת מיד ──────────────
insert into booking_event_types (slug, name, description, duration_minutes, color, sort_order)
values (
  'intro',
  'שיחת היכרות',
  'שיחה קצרה להכיר, להבין איפה אתם נמצאים ולראות אם זה מתאים.',
  30,
  'blue',
  10
);

-- ברירת מחדל גלובלית: ראשון–חמישי, 9:00–17:00 (540–1020 דקות מחצות).
insert into booking_availability (event_type_id, weekday, start_minute, end_minute)
select null, weekday, 540, 1020
from generate_series(0, 4) as weekday;

-- ── Row Level Security ──────────────────────────────────────────────────
-- כמו בשאר הטבלאות: האפליקציה ניגשת עם service role שעוקף RLS, וזו שכבת
-- הגנה שנייה. שימו לב להבדל מהותי לעומת שאר המערכת — דף ההזמנה הוא *ציבורי*
-- ורץ בלי משתמש מחובר. הוא עדיין קורא דרך השרת בלבד (service role), ולכן
-- אין כאן שום policy ל-anon: גולש אנונימי לעולם לא מדבר עם הטבלאות ישירות.
alter table booking_settings enable row level security;
alter table booking_event_types enable row level security;
alter table booking_availability enable row level security;
alter table booking_blackouts enable row level security;
alter table bookings enable row level security;

create policy "team can read booking_settings" on booking_settings for select to authenticated using (true);
create policy "team can write booking_settings" on booking_settings for all to authenticated using (true) with check (true);

create policy "team can read booking_event_types" on booking_event_types for select to authenticated using (true);
create policy "team can write booking_event_types" on booking_event_types for all to authenticated using (true) with check (true);

create policy "team can read booking_availability" on booking_availability for select to authenticated using (true);
create policy "team can write booking_availability" on booking_availability for all to authenticated using (true) with check (true);

create policy "team can read booking_blackouts" on booking_blackouts for select to authenticated using (true);
create policy "team can write booking_blackouts" on booking_blackouts for all to authenticated using (true) with check (true);

create policy "team can read bookings" on bookings for select to authenticated using (true);
create policy "team can write bookings" on bookings for all to authenticated using (true) with check (true);
