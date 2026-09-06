-- ── אינדקסים למסכים שנקראים בכל יום ─────────────────────────────────────
--
-- ── מה זה פותר, ומה זה לא ──
-- המערכת כרגע מחזיקה 724 אנשי קשר ועשרות אינטראקציות. בגודל הזה פוסטגרס
-- סורק את הטבלה כולה מהר יותר משהוא קורא אינדקס, ולכן המיגרציה הזו כמעט
-- לא תיראה **היום**. היא נכתבת בשביל מה שכבר קורה: כל הודעה, כל ניוזלטר
-- וכל ייבוא אקסל מוסיפים שורות, והשאילתות שלמטה הן בדיוק אלה שגדלות
-- ליניארית עם הצטברות הנתונים ורצות בכל טעינת מסך.
--
-- העיכוב שמורגש עכשיו אינו מכאן אלא ממספר הנסיעות לשרת ומכך שהמסך לא הראה
-- דבר עד שכולן חזרו; זה טופל בקוד. זו החצי השני — שהמסד לא יהפוך לצוואר
-- הבקבוק הבא.
--
-- כל האינדקסים כאן הם `if not exists`, ולכן הרצה חוזרת של הקובץ בטוחה.

-- ── contacts ─────────────────────────────────────────────────────────────

-- טבלת אנשי הקשר ממוינת לפי created_at יורד בכל טעינה, ועם עימוד של מאה
-- שורות. בלי אינדקס פוסטגרס ממיין את כל הטבלה בכל בקשה כדי להחזיר מאה
-- שורות — עבודה שגדלה עם כל שורה שנוספת ואינה תלויה כלל בכמה מוצג.
create index if not exists contacts_created_at_idx on contacts (created_at desc);

-- סינון לפי סטטוס **יחד עם** אותו מיון. contacts_status_idx הקיים (0001)
-- יודע למצוא את השורות אבל לא להחזיר אותן ממוינות, ולכן המיון עדיין נעשה
-- בזיכרון. האינדקס המורכב עונה על שניהם.
create index if not exists contacts_status_created_idx on contacts (status, created_at desc);

-- קהל הניוזלטר: מי שיש לו מייל והוא לא הוסר. אינדקס חלקי — הוא מכיל רק את
-- השורות שעונות על התנאי, ולכן הוא קטן ונשאר קטן.
create index if not exists contacts_newsletter_audience_idx
  on contacts (status)
  where email is not null and email <> '' and unsubscribed_at is null;

-- ── חיפוש חופשי בשם, בטלפון ובמייל ───────────────────────────────────────
--
-- תיבת החיפוש בעמוד אנשי הקשר מריצה ilike '%טקסט%' על שלוש עמודות. תבנית
-- שמתחילה ב-% אינה יכולה להשתמש באינדקס B-tree כלל — היא תמיד סריקה מלאה.
-- pg_trgm הוא ההרחבה שפותרת בדיוק את זה: היא מפרקת טקסט לשלשות אותיות
-- ומאנדקסת אותן, וכך גם חיפוש שמתחיל באמצע מילה עובר דרך אינדקס.
--
-- הבלוק מגלה היכן ההרחבה כבר מותקנת במקום להניח. ב-Supabase היא יושבת
-- כרגיל ב-schema בשם extensions, אבל בפרויקטים ישנים היא לפעמים ב-public —
-- ואז שם ה-operator class שונה, והמיגרציה הייתה נופלת על שגיאה שלא מסבירה
-- דבר למי שמריץ אותה בעורך ה-SQL. אם אי אפשר להתקין אותה כלל, שאר
-- המיגרציה עדיין רצה והחיפוש פשוט נשאר כפי שהוא היום.
do $$
declare
  trgm_schema text;
begin
  select n.nspname into trgm_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if trgm_schema is null then
    begin
      create schema if not exists extensions;
      create extension pg_trgm with schema extensions;
      trgm_schema := 'extensions';
    exception
      when others then
        raise notice 'pg_trgm unavailable (%), skipping trigram indexes', sqlerrm;
        return;
    end;
  end if;

  execute format(
    'create index if not exists contacts_full_name_trgm_idx on contacts using gin (full_name %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists contacts_phone_trgm_idx on contacts using gin (phone %I.gin_trgm_ops)',
    trgm_schema
  );
  execute format(
    'create index if not exists contacts_email_trgm_idx on contacts using gin (email %I.gin_trgm_ops)',
    trgm_schema
  );
end
$$;

-- ── interactions ─────────────────────────────────────────────────────────

-- "כמה הודעות יצאו החודש" ושתי סדרות המגמה בדף הבית מסננות לפי type ואז
-- לפי טווח תאריכים. האינדקס היחיד שהיה קיים על הטבלה מתחיל ב-contact_id,
-- ולכן שאילתה שאינה מציינת איש קשר לא יכלה להיעזר בו כלל.
create index if not exists interactions_type_created_idx
  on interactions (type, created_at desc);

-- ── אינדקס כפול שנוצר פעמיים ─────────────────────────────────────────────
-- 0001 יצרה interactions_contact_id_idx על (contact_id, created_at desc),
-- ו-0012 יצרה שוב את אותו אינדקס בדיוק בשם interactions_contact_created_idx.
-- שני אינדקסים זהים אינם מזיקים לקריאה, אבל **כל** הוספת שורה משלמת על
-- שניהם — וכל הודעה נכנסת היא הוספת שורה. נשאר זה של 0012, כי התצוגה
-- contact_activity מתועדת כמי שנשענת עליו בשמו.
drop index if exists interactions_contact_id_idx;

-- ── bookings ─────────────────────────────────────────────────────────────

-- דף הבית וגם "פגישות קרובות" שואלים תמיד על פגישות מאושרות בטווח תאריכים.
-- אינדקס חלקי: פגישות מבוטלות אינן נשאלות ואין סיבה שיתפסו בו מקום.
create index if not exists bookings_confirmed_starts_idx
  on bookings (starts_at)
  where status = 'confirmed';

-- ── הרשמות ───────────────────────────────────────────────────────────────

-- שלושת המונים של "דורש טיפול" ושורת המצב מסננים לפי שלב בלבד, בלי אירוע
-- או קורס. האינדקסים הקיימים מתחילים במזהה האירוע/הקורס ולכן אינם עוזרים.
create index if not exists event_registrations_stage_idx
  on event_registrations (stage, created_at desc);
create index if not exists course_registrations_stage_idx
  on course_registrations (stage, created_at desc);

-- "כמה אנשים במסעות כרגע" ורשימת המסעות סופרות לפי state.
create index if not exists journey_enrollments_state_idx
  on journey_enrollments (state, journey_id);
