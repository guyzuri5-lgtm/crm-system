-- תמונת המארח והתנהגות אירועי יום־שלם ביומן
--
-- הרצה: Supabase SQL editor, אחרי 0005_booking.sql ו-0007_booking_date_overrides.sql.
--
-- המיגרציה הזו *מוסיפה* עמודות ואינה מתחילה בבלוק reset כמו קודמותיה:
-- booking_settings היא שורת ההגדרות החיה של המערכת (אזור זמן, מזהה יומן),
-- ומחיקתה כדי ליצור אותה מחדש הייתה מאפסת הגדרות אמיתיות. add column
-- if not exists הוא מה שהופך את זה לבטוח בהרצה חוזרת.

-- ── אירועי יום־שלם ──────────────────────────────────────────────────────
-- ברירת המחדל false, וזה תיקון של התנהגות ולא רק אפשרות חדשה: קודם לכן
-- הזמינות נשלפה מגוגל דרך freeBusy, שמחזיר אירוע יום־שלם כבלוק תפוס של 24
-- שעות. יום הולדת, חג, או תזכורת יום־שלם מחקו יום שלם של פגישות אפשריות
-- בלי שום סימן. מי שכן מסמן חופשות כאירוע יום־שלם ורוצה שהן יחסמו — מדליק.
alter table booking_settings
  add column if not exists block_all_day_events boolean not null default false;

-- ── כרטיס המארח בדף ההזמנה הציבורי ─────────────────────────────────────
-- שלושתם nullable: דף ההזמנה עובד בלעדיהם בדיוק כפי שעבד עד היום, והם
-- מתווספים אליו רק כשמולאו.
alter table booking_settings
  add column if not exists host_name text;
alter table booking_settings
  add column if not exists host_title text;
-- כתובת ציבורית מלאה של התמונה, לא נתיב באחסון: הדף שמציג אותה הוא ציבורי
-- ורץ בלי סשן, ולכן אין לו במי לחתום URL. ראו את הבאקט שנוצר למטה.
alter table booking_settings
  add column if not exists host_photo_url text;

-- ── באקט לתמונת המארח ───────────────────────────────────────────────────
-- public = true: הקובץ נקרא מדף ההזמנה הציבורי, ואין שם משתמש מחובר שאפשר
-- לחתום עבורו כתובת זמנית. ההעלאה עצמה עוברת דרך service role בלבד (ראו
-- uploadHostPhotoAction), ולכן אין כאן שום policy ל-anon — גולש אנונימי
-- יכול לקרוא את הקובץ, ולא לכתוב לבאקט.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-assets',
  'booking-assets',
  true,
  2097152, -- 2MB. תמונת פרופיל אחת, לא גלריה.
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
