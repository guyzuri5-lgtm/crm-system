-- ── טריגר מסע חדש: "רכש את הקורס" ─────────────────────────────────────────
--
-- מה שהיה חסר: כל שישה הטריגרים הקיימים מדברים עם מי ש*עוד לא* קנה
-- (מתעניין, השאיר פרטים, מילא שאלון) או עם מצב כללי (סטטוס, פגישה).
-- אחרי הרכישה — ליווי, קישור לחומרים, "איך הולך לך אחרי שבוע" — לא היה
-- לזה שום טריגר, ולכן גם לא הייתה דרך לתזמן הודעה למועד הרכישה של כל
-- לקוח בנפרד.
--
-- הבחירה במסע ולא במנגנון תזכורות חדש היא מכוונת: המסע כבר יודע לזכור
-- איפה כל אדם עומד, לתזמן "X ימים אחרי הקודמת", להסתעף לפי תנאי, ולעצור
-- כשהלקוח עונה. מנגנון שני היה משכפל את כל זה כדי להרוויח כלום.
--
-- הרצה: Supabase SQL editor, אחרי 0033_performance_indexes.sql.

alter table journeys drop constraint if exists journeys_entry_type_check;

alter table journeys add constraint journeys_entry_type_check
  check (entry_type in (
    'status', 'quiz', 'booking', 'course_lead',
    'event_interest', 'course_interest', 'course_paid'
  ));

comment on column journeys.entry_type is
  'status | quiz | booking | course_lead | event_interest | course_interest | course_paid. '
  'ל-status, event_interest, course_interest ו-course_paid יש ערך נלווה ב-entry_value.';

-- ── למה אין כאן עמודה חדשה ─────────────────────────────────────────────────
--
-- הצירוף ל-course_paid מסונן ב-‎paid_at >= journeys.created_at‎ (ראו
-- enrollForJourney). זה נדרש כי "שילם" הוא מצב *קבוע* — להבדיל מ"מתעניין",
-- שאותו עוזבים ברגע שקונים. בלי הסינון, הדלקת מסע ליווי הייתה שולחת
-- "ברוך הבא, הנה הקישור" לכל מי שקנה אי פעם, שנה אחורה.
--
-- created_at ולא עמודת activated_at חדשה: מסע נוצר כבוי ונדלק אחרי שבונים
-- לו שלבים, ולכן שתי החותמות קרובות. מי שישלם בין היצירה להדלקה כן ייכנס —
-- וזה הרצוי, לא תקלה.
