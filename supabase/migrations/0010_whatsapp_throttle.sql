-- ויסות קצב שליחה בוואטסאפ
--
-- הרצה: Supabase SQL editor, אחרי 0009.
--
-- למה זה קיים: Green API אינו ה-API הרשמי של Meta, ולכן אין מאחורי המספר שום
-- ערובה. וואטסאפ חוסם מספרים שמתנהגים כמו ספאם, והדפוס המסוכן ביותר הוא בדיוק
-- זה של הקרון היומי כאן — קו חדש ששולח הודעות יזומות ברצף למי שלא פנה קודם.
--
-- למה טבלה ולא משתני סביבה: חימום מספר חדש הוא תהליך של שבועות שבו מעלים את
-- התקרה בהדרגה. משתנה סביבה ב-Vercel דורש deploy מחדש בכל שינוי; שורה בטבלה
-- נערכת מהדשבורד תוך שניות.

create table if not exists whatsapp_settings (
  -- אותו תכסיס כמו ב-booking_settings: boolean עם check אוכף שורה אחת בדיוק.
  id boolean primary key default true check (id),

  -- כמה הודעות אוטומטיות מותר שיצאו ביממה. ברירת המחדל שמרנית בכוונה —
  -- מספר חדש שמתחיל ב-200 הודעות ביום הוא מספר חסום.
  daily_limit integer not null default 40 check (daily_limit between 1 and 5000),

  -- טווח ההשהיה בין הודעה להודעה. טווח ולא ערך קבוע: רצף הודעות במרווחים
  -- זהים לחלוטין הוא חתימה של אוטומציה, ו-jitter פשוט מדויק יותר לקצב שבו
  -- אדם באמת שולח.
  min_delay_seconds integer not null default 6 check (min_delay_seconds between 0 and 600),
  max_delay_seconds integer not null default 18 check (max_delay_seconds between 0 and 600),

  -- מתג עצירה. אם מתחילות להגיע תלונות או שהמספר נראה מסומן — כיבוי מיידי
  -- בלי deploy ובלי לגעת בכללי האוטומציה עצמם.
  paused boolean not null default false,

  updated_at timestamptz not null default now(),

  constraint whatsapp_settings_delay_order check (max_delay_seconds >= min_delay_seconds)
);

insert into whatsapp_settings (id) values (true) on conflict (id) do nothing;

alter table whatsapp_settings enable row level security;

create policy "team can read whatsapp_settings"
  on whatsapp_settings for select to authenticated using (true);
create policy "team can write whatsapp_settings"
  on whatsapp_settings for all to authenticated using (true) with check (true);

-- הספירה היומית נגזרת מ-interactions ולא מעמודת מונה, כדי שלא יהיה מצב שבו
-- המונה והמציאות נפרדים (הודעה שנשלחה ולא נספרה, או להפך). האינדקס הוא מה
-- שהופך את הספירה הזו לזולה — היא רצה לפני *כל* הודעה בקרון.
create index if not exists interactions_whatsapp_out_sent_at_idx
  on interactions (created_at desc)
  where type = 'whatsapp_out';
