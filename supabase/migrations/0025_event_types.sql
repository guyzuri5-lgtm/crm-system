-- שני תיקוני טיפוס שנשכחו ב-0024.
--
-- 0024 הוסיפה אירועים בצד ה-TypeScript בלבד, ושתי רשימות קשיחות בצד ה-SQL
-- לא עודכנו איתה. שתיהן נכשלות בשקט או ברעש, וכדאי לדעת מה כל אחת עושה:
--
-- 1. interaction_type הוא enum, לא text. הרשמה לאירוע ניסתה לכתוב ליומן
--    'event_registered' — ערך שלא קיים ב-enum — וה-insert נכשל *בשקט*, כי
--    הקוד (כמו ה-webhook של השאלון) לא בודק את השגיאה שלו. התוצאה: הרשמה
--    נקלטה כרגיל, ובכרטיסיית איש הקשר לא הופיע דבר.
--
-- 2. journeys.entry_type הוא text עם check constraint שנכתב ב-0016 עם ארבעה
--    ערכים. מסע עם הטריגר החדש "נרשמה כמתעניינת לאירוע" היה נדחה על ידי
--    המסד — כלומר הכפתור "מסע למתעניינות" פשוט לא היה עובד.

-- ── ערך interaction_type חדש ───────────────────────────────────────────────
-- פוסטגרס לא מאפשר להסיר ערך מ-enum, ו-if not exists הוא מה שהופך את זה
-- לבטוח בהרצה חוזרת. הערך אינו בשימוש בשום insert במיגרציה הזו — בכוונה:
-- אי אפשר להשתמש בערך enum חדש באותה טרנזקציה שבה הוא נוסף. מסיבה זו
-- בדיוק עדכון תצוגת הפעילות יושב במיגרציה נפרדת (0026), בדיוק כפי
-- ש-0013 ו-0014 נחלקו.
alter type interaction_type add value if not exists 'event_registered';

-- ── טריגר כניסה חדש למסע ───────────────────────────────────────────────────
alter table journeys drop constraint if exists journeys_entry_type_check;

alter table journeys add constraint journeys_entry_type_check
  check (entry_type in ('status', 'quiz', 'booking', 'course_lead', 'event_interest'));

comment on column journeys.entry_type is
  'status | quiz | booking | course_lead | event_interest. ל-status ול-event_interest יש ערך נלווה ב-entry_value.';
