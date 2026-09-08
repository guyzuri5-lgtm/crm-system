-- 0039 — מסע שיווקי, ועצירה כשהלקוח קונה.
--
-- שלושה שינויים שנולדו מאותו משפך אחד: מגנט לידים (מתנה בתמורה למייל) ואחריו
-- סדרת מיילים שמובילה לרכישה. שלושתם דברים שהמנוע לא ידע לעשות עד היום.
--
-- 1. journeys.marketing — האם המסע הזה הוא דיוור שיווקי או הודעה תפעולית.
--    ההבחנה אינה סמנטית: היא קובעת ערוץ שליחה ב-Postmark, קישור הסרה בגוף
--    המייל, כותרת List-Unsubscribe, וכיבוד של unsubscribed_at. עד היום כל
--    מיילי המסעות יצאו כתפעוליים — נכון למייל "הנה הקישור לקורס שרכשת",
--    שגוי לסדרה שמנסה למכור. ברירת המחדל false כדי שהמסעות הקיימים
--    (קישור לקורס, תזכורות) יישארו בדיוק כפי שהם.
--
-- 2. journeys.stop_on_purchase — איזו רכישה מסיימת את המסע. ריק = אף אחת,
--    וזו ההתנהגות שהייתה. הצורה זהה ל-entry_value ומאותה סיבה: {"course_id":…}
--    או {"event_id":…}, בלי מפתח זר, כי גם entry_value חי כך. בלי זה, מי
--    שקנה אחרי המייל השני המשיך לקבל את השלישי שמנסה למכור לו את מה שכבר קנה.
--
-- 3. שני מצבי צירוף חדשים. אפשר היה לסמן אותם completed ולחסוך מיגרציה, אבל
--    אז המסך היה אומר "סיים את המסע" על מי שקנה — וזו בדיוק השאלה שבגללה
--    פותחים מסע.

alter table journeys
  add column if not exists marketing boolean not null default false,
  add column if not exists stop_on_purchase jsonb;

comment on column journeys.marketing is
  'דיוור שיווקי: ערוץ broadcast, קישור הסרה בגוף המייל, וכיבוד unsubscribed_at. false = הודעה תפעולית.';
comment on column journeys.stop_on_purchase is
  'איזו רכישה עוצרת את המסע: {"course_id":"…"} או {"event_id":"…"}. ריק = אף אחת.';

alter table journey_enrollments drop constraint if exists journey_enrollments_state_check;
alter table journey_enrollments add constraint journey_enrollments_state_check
  check (state in (
    'active',
    'completed',
    'stopped_replied',
    'stopped_manual',
    -- קנה את מה שהמסע ניסה למכור לו
    'stopped_purchased',
    -- ביקש להסיר את עצמו מהדיוור, והמסע הזה שיווקי
    'stopped_unsubscribed'
  ));

-- הצירוף נבדק מול "מי כבר קנה" בכל ריצה, ולכן השאילתה הזו רצה כל רבע שעה
-- על כל מסע שיש לו stop_on_purchase. אינדקס חלקי על השלב המשלם, כי הוא
-- מיעוט מהשורות ורק הוא נשאל.
create index if not exists course_registrations_paid_idx
  on course_registrations (course_id) where stage = 'paid';
create index if not exists event_registrations_paid_idx
  on event_registrations (event_id) where stage = 'paid';
