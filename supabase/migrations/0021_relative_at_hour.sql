-- ── שעה ביום גם לתזמון "אחרי הקודמת" ───────────────────────────────────────
--
-- "3 ימים אחרי הכרטיסייה הקודמת" ירש עד עכשיו את שעת השליחה של הקודמת:
-- לקוח שנכנס למסע ב-23:40 קיבל גם את ההודעה הבאה ב-23:40. אין דרך לומר
-- "שלושה ימים אחרי, אבל בבוקר".
--
-- עמודה אופציונלית ולא שינוי ברירת מחדל: ריק = ההתנהגות הישנה (אותה שעה),
-- ערך = דקות מחצות שאליהן מיישרים אחרי הוספת הימים. אם השעה המבוקשת כבר
-- עברה באותו יום, המנוע גולש ליום המחרת — הודעה לעולם לא נשלחת "אחורה".

alter table journey_steps
  drop constraint if exists journey_steps_relative_at_minutes_check;

alter table journey_steps
  add column if not exists relative_at_minutes int null;

alter table journey_steps
  add constraint journey_steps_relative_at_minutes_check
  check (relative_at_minutes is null or (relative_at_minutes >= 0 and relative_at_minutes < 1440));

comment on column journey_steps.relative_at_minutes is
  'רק ל-timing=relative: דקות מחצות ליישור השעה אחרי הוספת wait_days. ריק = באותה שעה כמו השליחה הקודמת. 540 = 09:00.';
