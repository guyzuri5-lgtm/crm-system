-- ── עיגון מסע לפגישה ───────────────────────────────────────────────────────
--
-- עד עכשיו כל שלב תוזמן *קדימה מהכניסה*: "יומיים אחרי שנכנס". תזכורת לפגישה
-- זקוקה לכיוון ההפוך — "ערב לפני", "שעה לפני" — כלומר תזמון אחורה מאירוע
-- עתידי ידוע.
--
-- זה לא ניתן לביטוי ב-wait_days, ולא בגלל היחידה אלא בגלל נקודת הייחוס:
-- מרגע הכניסה אי אפשר לדעת כמה זמן נשאר עד הפגישה, כי כל לקוח קובע למועד
-- אחר. לכן העוגן הוא תכונה של המסע, וההיסט הוא תכונה של השלב.
--
--   anchor = 'enrollment'  →  wait_days, כמו עד היום
--   anchor = 'booking'     →  offset_minutes מ-starts_at של הפגישה
--
-- ── היחידה כאן היא דקות, ובכוונה ──
-- בניגוד ל-wait_days. ההיסט נמדד מאירוע שהשעה שלו ידועה בדיוק, ו"שעה לפני"
-- הוא מקרה שימוש אמיתי. שהקרון היומי לא יוכל לממש דיוק כזה היא מגבלת
-- *תשתית* ולא של המודל — ברגע שהוא ירוץ תכוף יותר, אותם מסעות יפעלו בדיוק
-- הנכון בלי לגעת בנתונים.

alter table journeys
  add column if not exists anchor text not null default 'enrollment';

alter table journeys
  drop constraint if exists journeys_anchor_check;

alter table journeys
  add constraint journeys_anchor_check
  check (anchor in ('enrollment', 'booking'));

comment on column journeys.anchor is
  'enrollment = תזמון קדימה מהכניסה (wait_days). booking = תזמון יחסית לפגישה (offset_minutes).';

-- שלילי = לפני הפגישה. -60 הוא שעה לפני, -960 הוא 16 שעות לפני (ערב קודם).
alter table journey_steps
  add column if not exists offset_minutes int not null default 0;

comment on column journey_steps.offset_minutes is
  'דקות יחסית ל-starts_at של הפגישה. שלילי = לפני. בשימוש רק כש-journeys.anchor = booking.';

-- הפגישה שאליה הצירוף הזה קשור. nullable כי מסע שמעוגן לכניסה אינו קשור
-- לפגישה כלל.
--
-- set null ולא cascade: פגישה שנמחקת לא צריכה למחוק את ההיסטוריה של מי שכבר
-- קיבל הודעות. המנוע מזהה את ה-null ומסיים את הצירוף.
alter table journey_enrollments
  add column if not exists booking_id uuid references bookings (id) on delete set null;

create index if not exists journey_enrollments_booking_idx
  on journey_enrollments (booking_id) where booking_id is not null;
