-- חריגות זמינות לתאריך ספציפי — היומן הידני
--
-- הרצה: Supabase SQL editor, אחרי 0005_booking.sql (ואחרי 0006_fields.sql, אם הורצה).
--
-- למה טבלה נפרדת ולא עוד עמודה ב-booking_availability: השעות השבועיות הן
-- *דפוס* ("כל יום שני 9–17"), והחריגות הן *עובדות על תאריך* ("ב-15 בספטמבר
-- רק 18:00–21:00"). ערבוב של השניים בטבלה אחת היה מחייב עמודת weekday שהיא
-- NULL בחצי מהשורות ועמודת תאריך שהיא NULL בחצי השני, ואת כל הקוד לבדוק מי
-- מהן מלאה בכל שאילתה.
--
-- סמנטיקה — שלושה מצבים לכל תאריך:
--   אין שורות בכלל        → נופלים לשעות השבועיות של אותו יום בשבוע
--   שורה עם start/end NULL → היום חסום לגמרי, גם אם הוא יום עבודה רגיל
--   שורות עם שעות         → *רק* הן חלות באותו תאריך; השבועיות לא מתווספות
--
-- ההבדל מ-booking_blackouts: חסימה היא חלון זמן שנחסם (14:00–16:00 ביום
-- מסוים), וחריגה היא הגדרה מחדש של כל היום. שתיהן נחוצות — חסימה נוחה
-- ל"יש לי משהו באמצע היום", וחריגה נוחה ל"ביום הזה אני עובד אחרת".

drop table if exists booking_date_overrides cascade;

create table booking_date_overrides (
  id uuid primary key default gen_random_uuid(),
  -- ריק = חל על כל סוגי הפגישות. אותו כלל דריסה כמו booking_availability.
  event_type_id uuid references booking_event_types (id) on delete cascade,
  override_date date not null,
  -- שניהם NULL = "לא זמין ביום הזה". אחרת חלון שעות, בדקות מחצות, באזור הזמן
  -- שב-booking_settings — בדיוק כמו booking_availability.
  start_minute integer,
  end_minute integer,
  created_at timestamptz not null default now(),
  constraint booking_date_overrides_window_check check (
    (start_minute is null and end_minute is null)
    or (
      start_minute is not null and end_minute is not null
      and start_minute between 0 and 1440
      and end_minute between 0 and 1440
      and end_minute > start_minute
    )
  )
);

create index booking_date_overrides_lookup_idx
  on booking_date_overrides (override_date, event_type_id);

-- "לא זמין" הוא הצהרה על כל היום, ולכן הוא לא יכול לחיות לצד חלונות שעות
-- על אותו תאריך — זה היה מצב סותר. אינדקס יחיד חלקי אוכף שורה כזו אחת בלבד,
-- והקוד שמוסיף אותה מוחק קודם את שאר השורות של אותו תאריך.
create unique index booking_date_overrides_one_unavailable_idx
  on booking_date_overrides (override_date, coalesce(event_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where start_minute is null;

alter table booking_date_overrides enable row level security;

create policy "team can read booking_date_overrides"
  on booking_date_overrides for select to authenticated using (true);
create policy "team can write booking_date_overrides"
  on booking_date_overrides for all to authenticated using (true) with check (true);
