-- ── הסרת דף הנחיתה הישן של קורס המדיטציה ───────────────────────────────────
--
-- 0013 בנתה מסלול קליטה משלה לדף הנחיתה של הקורס: endpoint ציבורי
-- (/api/webhooks/course) וטבלה משלו (course_leads). זה היה המנגנון היחיד
-- שהיה אז, לפני שקיימת בכלל טבלת courses.
--
-- 0028 בנתה את המסלול האמיתי — courses + course_registrations + טופס הרשמה
-- מוטמע — והשאירה גשר: הדגל legacy_webhook על קורס, ומקור הרשמה 'legacy',
-- כדי שלידים מהדף הישן יזרמו למבנה החדש. ההערה שם ניסחה את התנאי ליציאה:
-- "הפרדה שלו מ-landing היא מה שיאפשר לדעת מתי אפשר לכבות את הדף הישן".
--
-- ── התשובה, שנמדדה מול הפרודקשן ב-14.9.2026 ──
--   course_leads ................................ 0 שורות
--   interactions מסוג course_lead ............... 0 שורות
--   course_registrations עם source='legacy' ..... 0 שורות
--   קורסים עם legacy_webhook=true ............... 0
--   course_registrations עם source='landing' .... 5 (4 מהן שילמו)
--
-- כלומר הגשר מעולם לא נשא איש. ב-6.9.26 הוחלף הבלוק בדף הנחיתה עצמו בטופס
-- המוטמע מהמערכת, ומאז כל הרשמה נכנסת דרך המסלול החדש. אף קובץ בבלוקי דף
-- הנחיתה לא מפנה עוד ל-endpoint הישן.
--
-- ── מה יורד ──
-- הטבלה, הדגל והאינדקס שאוכף אותו, וערך המקור 'legacy'. ה-endpoint עצמו
-- נמחק מהקוד באותו קומיט.
--
-- ── מה נשאר בכוונה ──
-- הערך 'course_lead' ב-enum של interaction_type. הסרת ערך מ-enum בפוסטגרס
-- דורשת בניית הטיפוס מחדש ואיתו את שני ה-views שתלויים בו (0026, 0029) —
-- סיכון על מסד חי בתמורה לניקיון בלבד. אין שורה אחת שנושאת אותו, ואחרי
-- מחיקת ה-endpoint גם אין מי שיכתוב אותו.
--
-- ── בטוח להריץ ──
-- אין אובדן נתונים: הטבלה ריקה ושתי העמודות שיורדות ריקות מתוכן משמעותי.
-- 0013 ו-0028 נשארות בתיקייה — הן כבר רצו, ומיגרציה היא רישום של מה שקרה.
--
-- הרצה: Supabase SQL editor, אחרי 0040_quiz_progress.sql.

-- ── 1. הטבלה של הדף הישן ──
drop table if exists course_leads;

-- ── 2. הגשר לקורסים ──
-- האינדקס לפני העמודה: drop column היה מפיל אותו לבד, אבל סדר מפורש אומר
-- מה נמחק ולא מסתמך על תופעת לוואי.
drop index if exists courses_single_legacy_webhook_idx;
alter table courses drop column if exists legacy_webhook;

-- ── 3. מקור ההרשמה 'legacy' ──
-- ה-check נבנה ב-0028 ומוחלף כאן בגרסה בלי הערך. אין שורה שנושאת אותו,
-- ולכן ההחלפה לא תיכשל.
alter table course_registrations drop constraint if exists course_registrations_source_check;
alter table course_registrations
  add constraint course_registrations_source_check
  check (source in ('landing', 'meta', 'manual'));

-- ── 4. סגירת חוב מהקומיט הקודם ──
-- טריגר הכניסה course_lead ירד מהמסעות כשהתברר שהוא מצביע על מקור ריק.
-- ה-check נשאר אז מתירני, וכאן הוא מתיישר עם הקוד. אין מסע שנושא את הערך.
alter table journeys drop constraint if exists journeys_entry_type_check;
alter table journeys
  add constraint journeys_entry_type_check
  check (entry_type in (
    'status', 'quiz', 'booking',
    'event_interest', 'course_interest', 'course_paid'
  ));
