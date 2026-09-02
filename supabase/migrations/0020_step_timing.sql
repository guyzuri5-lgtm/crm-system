-- ── התזמון יורד מהמסע אל הכרטיסייה ─────────────────────────────────────────
--
-- 0018 שם את העוגן על המסע: או שכל השלבים נמדדים מהכניסה, או שכולם מהפגישה.
-- זו אותה שגיאה שתוקנה ב-0019 עם התנאי, במקום אחר — תכונה שהיא באמת של
-- הפריט הבודד הושמה על האוסף.
--
-- התוצאה בפועל: "מייל מיד אחרי הקביעה, ותזכורת ערב לפני הפגישה" חייב היה
-- להתפצל לשני מסעות נפרדים על אותו לקוח.
--
-- ── ולמה שלושה סוגים ולא שניים ──
-- "בוקר של הפגישה" אינו מרחק מהפגישה אלא שעה ביום. לפגישה ב-15:00 הבוקר
-- הוא שש שעות לפני; לפגישה ב-11:00 הוא שעתיים. היסט בדקות לא יכול לתאר את
-- זה, ולכן יש סוג שלישי שמדבר בשעות ולא במרחקים.

alter table journey_steps
  add column if not exists timing text not null default 'relative';

alter table journey_steps
  drop constraint if exists journey_steps_timing_check;

alter table journey_steps
  add constraint journey_steps_timing_check
  check (timing in ('relative', 'booking_offset', 'booking_day_at'));

comment on column journey_steps.timing is
  'relative = wait_days מהכרטיסייה הקודמת | booking_offset = offset_minutes מהפגישה | booking_day_at = day_offset + day_at_minutes ביום הפגישה';

-- ‎0 = יום הפגישה, ‎-1 = היום שלפניו. בשימוש רק ב-booking_day_at.
alter table journey_steps
  add column if not exists day_offset int not null default 0;

-- דקות מחצות, בשעון של הלקוח. 540 = 09:00, 1200 = 20:00.
--
-- באזור הזמן של המוזמן ולא בשלנו: "בוקר" חייב להיות בוקר *אצלו*, אחרת
-- תזכורת ללקוח בניו יורק תגיע לו בלילה.
alter table journey_steps
  add column if not exists day_at_minutes int not null default 540
  check (day_at_minutes >= 0 and day_at_minutes < 1440);

-- העוגן ברמת המסע מיותר מרגע שהתזמון יושב על הכרטיסייה. השאלה היחידה
-- שנשארה — "האם צריך פגישה כדי להצטרף" — נגזרת מהשלבים עצמם: אם יש בהם
-- ולו אחד שמעוגן לפגישה, צריך פגישה.
alter table journeys drop column if exists anchor;
