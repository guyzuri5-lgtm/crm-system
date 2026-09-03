-- ── אירועים ────────────────────────────────────────────────────────────────
--
-- אירוע הוא מפגש בתאריך: סדנה, ערב, מחזור פתיחה. שלוש טבלאות ולא אחת, כי
-- שלושה דברים שונים נשמרים כאן — *מה* האירוע, *מי* נרשם אליו, ו*מה כבר יצא*
-- אליו בתזכורות.
--
-- ── למה שדות העיצוב יושבים על השורה ולא בקובץ ──
-- דף ההרשמה הציבורי הוא הנכס השיווקי של האירוע, ומי שעורך אותו הוא בעל העסק
-- ולא מפתח. לכן הכותרת, תמונת הרקע, טקסט הכפתור ועמוד התודה הם עמודות
-- רגילות שנערכות מהדשבורד — ולא תבנית בקוד שדורשת deploy כדי לשנות מילה.

create table events (
  id uuid primary key default gen_random_uuid(),
  -- הכתובת הציבורית: /event/{slug}. ייחודי, כי הוא המפתח שהקהל מגיע דרכו.
  slug text not null unique,
  name text not null,                            -- גם הכותרת הראשית בדף ההרשמה
  subtitle text,                                 -- כותרת משנה מתחת לכותרת
  description text,
  starts_at timestamptz not null,
  location text,
  capacity int,                                  -- null = בלי הגבלה
  grow_link text,                                -- לינק תשלום מגרואו

  -- [{key,label,type:'text'|'select',options:[]}] — שדות הטופס המותאמים.
  -- jsonb ולא טבלה: הם נקראים ונכתבים תמיד יחד עם האירוע, בסדר שנקבע בעורך,
  -- ואף שאילתה לא מחפשת "כל האירועים עם שדה X".
  custom_fields jsonb not null default '[]'::jsonb,

  -- ── עיצוב דף ההרשמה ──
  header_image_url text,                         -- תמונת רקע לחלק העליון (באקט media, 0023)
  form_description text,                         -- תיאור קצר בתוך הטופס
  button_text text not null default 'המשך לתשלום מאובטח בגרואו',
  show_datetime boolean not null default true,   -- הצגת תאריך/שעה/מיקום
  show_capacity boolean not null default true,   -- הצגת "נותרו N מקומות"

  -- ── עיצוב דף התודה ──
  thankyou_title text not null default 'ההרשמה נקלטה!',
  thankyou_text text,
  thankyou_show_calendar boolean not null default true,
  thankyou_show_image boolean not null default false,

  remind_day_before boolean not null default true,
  remind_hour_before boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── מי נרשם ────────────────────────────────────────────────────────────────
--
-- שלושה שלבים ולא דגל "שילם/לא שילם": מי שהשאירה פרטים ולא הגיעה לתשלום היא
-- לא כישלון אלא ליד — היא מי שהמסע למתעניינות מדבר אליה. השלב עולה בדרגה
-- בלבד (interested → registered → paid), כדי שרישום חוזר לא יוריד מישהי
-- ששילמה בחזרה למתעניינת.
create table event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  stage text not null default 'interested'
    check (stage in ('interested', 'registered', 'paid')),
  source text not null default 'landing'
    check (source in ('landing', 'meta', 'manual')),
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  -- אדם אחד, רישום אחד לאירוע. זה גם מה שהופך "הירשמי שוב" לעדכון ולא לכפילות.
  unique (event_id, contact_id)
);

-- ── מה כבר יצא ─────────────────────────────────────────────────────────────
--
-- אותו תפקיד כמו automation_rule_runs: השורה *היא* המנעול. הקרון רץ כל רבע
-- שעה, וחלון "בעוד 50–70 דקות" נפתח לכמה ריצות — בלי הרשומה הזו אותה נרשמת
-- הייתה מקבלת את אותה תזכורת שלוש פעמים. המפתח הראשי הוא המונע, לא הבדיקה
-- שלפניו: שתי ריצות במקביל, רק אחת תצליח להכניס.
create table event_reminders_sent (
  registration_id uuid not null references event_registrations (id) on delete cascade,
  kind text not null check (kind in ('day_before', 'hour_before')),
  sent_at timestamptz not null default now(),
  primary key (registration_id, kind)
);

-- ── אינדקסים ───────────────────────────────────────────────────────────────

-- הקרון שואל בכל ריצה "אילו אירועים פעילים מתחילים בקרוב". אינדקס חלקי,
-- כי אירוע שעבר או כובה לא נשאל עליו יותר.
create index events_upcoming_idx on events (starts_at) where active;

-- מסך האירוע ומוני הדשבורד סופרים לפי אירוע ולפי שלב.
create index event_registrations_event_idx on event_registrations (event_id, stage);

-- כרטיסיית איש הקשר מציגה לאילו אירועים הוא רשום.
create index event_registrations_contact_idx on event_registrations (contact_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- הצוות בלבד, כמו בכל שאר הטבלאות. דף ההרשמה הציבורי אינו נשען על כך: הוא
-- קורא וכותב דרך service role בצד השרת (אותו דפוס כמו /book), ולכן אין כאן
-- שום policy ל-anon — גולש אנונימי לא נוגע בטבלאות האלה ישירות.
alter table events                 enable row level security;
alter table event_registrations    enable row level security;
alter table event_reminders_sent   enable row level security;

create policy "team reads events"         on events               for select to authenticated using (true);
create policy "team writes events"        on events               for all    to authenticated using (true) with check (true);
create policy "team reads registrations"  on event_registrations  for select to authenticated using (true);
create policy "team writes registrations" on event_registrations  for all    to authenticated using (true) with check (true);
create policy "team reads reminders"      on event_reminders_sent for select to authenticated using (true);
create policy "team writes reminders"     on event_reminders_sent for all    to authenticated using (true) with check (true);

-- ── יומן איש הקשר ──────────────────────────────────────────────────────────
-- סוג רשומה חדש ל-interactions: event_registered. אין כאן constraint לעדכן —
-- הטיפוס נאכף ב-TypeScript בלבד (ראו InteractionType ב-database.types.ts).
comment on table event_registrations is
  'הרשמות לאירועים. השלב עולה בדרגה בלבד: interested → registered → paid.';
