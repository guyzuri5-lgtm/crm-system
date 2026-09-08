-- ── מה שהמסכים שואלים על מסירה ──────────────────────────────────────────────
--
-- 0037 יצרה את מקום האמת (message_receipts). כאן נבנות שתי השאלות שהמסכים
-- שואלים בפועל, כתצוגות ולא כשאילתות מהקוד:
--   "בדיוור של אתמול — כמה נפתחו וכמה נלחצו"
--   "בכרטיסייה הזו במסע — כמה קראו את ההודעה"
--
-- למה תצוגה: התשובה היא צבירה על *כל* הנמענים, ובקוד היא הייתה שליפת אלפי
-- שורות לזיכרון רק כדי לספור אותן. פוסטגרס עושה את זה בצד שלו, ובלי לשלוח
-- לרשת דבר מלבד המספר.

-- ── external_id על ריצות המסע ───────────────────────────────────────────────
--
-- שורת הריצה ידעה עד עכשיו רק "יצאה הודעה". איזו הודעה — לא, ולכן אי אפשר
-- היה לשאול אם היא נקראה. העמודה הזו היא החוליה החסרה: אותו מזהה שנשמר על
-- שורת היומן, וש-message_receipts מפתחת לפיו.
--
-- ריק בשורות שנוצרו לפני המיגרציה. הן פשוט לא נספרות במדד הקריאה.
alter table journey_step_runs
  add column if not exists external_id text;

comment on column journey_step_runs.external_id is
  'wamid או MessageID של ההודעה שיצאה בשלב הזה. מתחבר ל-message_receipts.external_id.';

create index if not exists journey_step_runs_external_id_idx
  on journey_step_runs (external_id)
  where external_id is not null;

-- ── ביצועי דיוור ────────────────────────────────────────────────────────────
--
-- שורה אחת לכל ניוזלטר. הבסיס הוא newsletter_recipients ולא message_receipts:
-- הצירוף חייב לספור גם את מי שאין עליו שום דיווח — נמען שלא פתח הוא בדיוק
-- מה שהמדד מודד, ו-inner join היה מוחק אותו מהמכנה.
drop view if exists newsletter_stats;

create view newsletter_stats as
select
  r.newsletter_id,
  count(*)                                                as recipients,
  count(*) filter (where r.status = 'sent')               as sent,
  -- כמה נמענים בכלל ניתנים למדידה. זה מה שמפריד בין "אף אחד לא פתח" לבין
  -- "לא נמדד" — דיוור שיצא לפני 0037 אין לו message_id, ובלי ההבחנה הזו
  -- הוא היה מוצג כ-0% פתיחה, כלומר ככישלון שמעולם לא קרה.
  count(r.message_id)                                     as measurable,
  count(*) filter (where mr.delivered_at is not null)     as delivered,
  count(*) filter (where mr.opened_at  is not null)       as opened,
  count(*) filter (where mr.clicked_at is not null)       as clicked,
  count(*) filter (where mr.failed_at  is not null)       as bounced,
  coalesce(sum(mr.open_count),  0)::int                   as total_opens,
  coalesce(sum(mr.click_count), 0)::int                   as total_clicks
from newsletter_recipients r
left join message_receipts mr on mr.external_id = r.message_id
group by r.newsletter_id;

comment on view newsletter_stats is
  'פתיחות וקליקים לכל ניוזלטר. opened במייל אינו מספר מדויק — ראו הערת 0037.';

-- ── ביצועי כרטיסייה במסע ────────────────────────────────────────────────────
--
-- שורה לכל כרטיסייה שיצאה ממנה ולו הודעה אחת. זה מה שמפריד בין "המסע שלח"
-- לבין "המסע הגיע": כרטיסייה ששלחה 40 הודעות ואיש לא קרא אותן היא כרטיסייה
-- שבורה, וזה לא נראה בשום מקום עד היום.
drop view if exists journey_step_stats;

create view journey_step_stats as
select
  s.journey_id,
  r.step_id,
  count(*)                                             as sent,
  count(*) filter (where mr.delivered_at is not null)  as delivered,
  count(*) filter (where mr.opened_at  is not null)    as opened,
  count(*) filter (where mr.clicked_at is not null)    as clicked,
  count(*) filter (where mr.failed_at  is not null)    as failed
from journey_step_runs r
join journey_steps s on s.id = r.step_id
left join message_receipts mr on mr.external_id = r.external_id
group by s.journey_id, r.step_id;

comment on view journey_step_stats is
  'כמה יצא וכמה נקרא בכל כרטיסייה. opened בוואטסאפ הוא הסימון הכחול, במייל טעינת תמונה.';
