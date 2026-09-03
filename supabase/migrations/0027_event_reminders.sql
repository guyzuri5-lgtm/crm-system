-- ── תזכורות אירוע: מהגדרה קשיחה בקוד לתבניות שנבחרות מהממשק ────────────────
--
-- 0024 הגדירה שתי תזכורות בוליאניות (remind_day_before / remind_hour_before)
-- עם טקסט שכתוב בקוד. שתי בעיות נפגשו שם:
--
-- 1. **הטקסט לא היה ניתן לעריכה** — שינוי מילה דרש deploy.
-- 2. **וגם לא היה נשלח.** מטא מרשה טקסט חופשי רק בתוך 24 שעות מהודעה
--    אחרונה של הלקוחה. יום לפני האירוע רובן כבר מחוץ לחלון, ולכן השליחה
--    נכשלה — מה שאומר שהתזכורות פשוט לא עבדו.
--
-- הפתרון לשתיהן זהה: התזכורת היא **תבנית מאושרת ב-Meta**. הטקסט חי אצל
-- מטא (שם הוא גם מאושר), והמערכת שולטת במה שבאמת שלה — *איזו* תבנית,
-- *מתי* היא יוצאת, ומה נכנס למשתנים שלה.
--
-- ── שני בסיסי ספירה, כי יש שתי שאלות שונות ──
--   event    — "יום לפני האירוע"      → נספר לאחור מ-events.starts_at
--   purchase — "שעה אחרי הרכישה"      → נספר קדימה מ-event_registrations.paid_at
-- הראשון מתזמן את כולן לאותו רגע; השני נותן לכל נרשמת שעון משלה.

create table event_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,

  -- restrict ולא cascade: מחיקת תבנית שתזכורת פעילה נשענת עליה היא תאונה,
  -- ועדיף שהיא תיחסם בקול מאשר שהתזכורת תיעלם בשקט. אותו נימוק כמו במסעות.
  template_id uuid not null references message_templates (id) on delete restrict,

  basis text not null check (basis in ('event', 'purchase')),

  -- דקות, עם סימן. שלילי = לפני נקודת הייחוס, חיובי = אחריה.
  -- ‎-1440‎ עם basis=event  → יממה לפני האירוע
  -- ‎60‎    עם basis=purchase → שעה אחרי התשלום
  offset_minutes int not null,

  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index event_reminders_event_idx on event_reminders (event_id) where active;

-- ── מה כבר יצא ─────────────────────────────────────────────────────────────
--
-- נבנית מחדש: המפתח היה (registration_id, kind) כששתי התזכורות היו קבועות.
-- עכשיו יש כמה שרוצים, ולכן הזיהוי הוא מול ההגדרה עצמה. התפקיד לא השתנה —
-- השורה *היא* המנעול, והמפתח הראשי הוא מה שמונע שליחה כפולה כששתי ריצות
-- קרון נפגשות באותו חלון.
drop table if exists event_reminders_sent;

create table event_reminders_sent (
  registration_id uuid not null references event_registrations (id) on delete cascade,
  reminder_id uuid not null references event_reminders (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (registration_id, reminder_id)
);

-- ── ניקוי ──────────────────────────────────────────────────────────────────
-- שתי העמודות הישנות הופכות לחסרות משמעות. השארה שלהן הייתה מזמינה מישהו
-- להדליק מתג שכבר אינו מחובר לכלום.
alter table events drop column if exists remind_day_before;
alter table events drop column if exists remind_hour_before;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table event_reminders       enable row level security;
alter table event_reminders_sent  enable row level security;

create policy "team reads event reminders"  on event_reminders      for select to authenticated using (true);
create policy "team writes event reminders" on event_reminders      for all    to authenticated using (true) with check (true);
create policy "team reads reminders sent"   on event_reminders_sent for select to authenticated using (true);
create policy "team writes reminders sent"  on event_reminders_sent for all    to authenticated using (true) with check (true);

comment on table event_reminders is
  'הגדרות התזכורות של אירוע: איזו תבנית מאושרת, ומתי — יחסית לאירוע או לרכישה.';
