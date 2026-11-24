-- ניקוי היומן של pg_cron, כדי שהמסד לא יגדל לנצח.
--
-- content-worker רץ כל דקה (0046, 0051) ו-crm-cron כל רבע שעה (0043).
-- כל ריצה כותבת שורה ל-cron.job_run_details, ו-pg_cron לא מוחק אותן
-- אף פעם: כ-1,500 שורות ביום שמצטברות בלי סוף, מול מגבלת 500MB של
-- התוכנית החינמית.
--
-- מה המיגרציה עושה:
--   1. מוחקת עכשיו את כל הרישומים שגילם מעל שבעה ימים.
--   2. מתזמנת משימה לילית (03:30 UTC) שעושה אותו דבר מדי יום.
--
-- המחיקה לא מחזירה מקום לדיסק מיד: השטח שהתפנה משמש לשורות הבאות, ולכן
-- המסד מפסיק לגדול. כדי להקטין אותו בפועל, מריצים אחרי המיגרציה **לבד,
-- בשאילתה נפרדת** (VACUUM לא רץ יחד עם פקודות אחרות):
--     vacuum full cron.job_run_details;
--
-- שבעה ימים מספיקים לבדיקת תקלות. הבדיקה האמיתית שהקרון חי היא
-- cron_heartbeat (ר' 0043), לא היומן הזה.

delete from cron.job_run_details
where end_time < now() - interval '7 days';

do $$
begin
  perform cron.unschedule('cron-log-cleanup');
exception
  when others then null;
end $$;

select cron.schedule(
  'cron-log-cleanup',
  '30 3 * * *',
  $job$
    delete from cron.job_run_details
    where end_time < now() - interval '7 days';
  $job$
);
