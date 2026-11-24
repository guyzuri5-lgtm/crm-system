-- ── קרון המסעות: מעירים את ורסל רק כשיש עבודה ─────────────────────────────
--
-- 24.11.2026, אחרי המעבר ל-Hobby בורסל (4 שעות Active CPU ל-30 יום מתגלגלים).
-- כל השכמה של /api/cron/check-rules עולה כ-2 שניות CPU גם כשאין מה לעשות,
-- ו-96 השכמות ביום הן כשעה וחצי לחודש. אותו דפוס כמו content_worker_due (0051, 0056).
--
-- pg_cron ממשיך לבדוק כל 15 דקות (בחינם, בתוך המסד), אבל קורא לורסל רק כש:
--  - שעה עגולה (UTC): ריצה מלאה — כללי "לא ענה X זמן", צירוף למסעות לפי סטטוס,
--    ניסיון חוזר לוורדפרס, ואירועים שהסתיימו באתר. גיא אישר עד שעה איחור לאלה;
--  - יש הרשמה פעילה במסע שהצעד הבא שלה הגיע (כולל "שעה לפני הפגישה");
--  - יש ניוזלטר מתוזמן שהגיע זמנו, או שנקטע באמצע שליחה;
--  - יש תזכורת לאירוע שהגיעה ועוד לא נשלחה (אותו חלון חסד של 6 שעות כמו event-engine.ts).
--
-- מה שלא תלוי בקרון ולכן לא נפגע: מסע שמתחיל מליד, מהרשמה או מתשלום
-- (kickoffJourneysForContact), ועדכון האירועים באתר בשמירת אירוע או בתשלום
-- (scheduleWordPressSync → syncSiteEvents).
--
-- כשל בבדיקה → מעירים (true), כמו ב-content_worker_due.

create or replace function crm_cron_due()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  soon timestamptz := now() + interval '1 minute';
begin
  -- ריצה מלאה פעם בשעה (המשימה רצה ב-0/15/30/45)
  if extract(minute from (now() at time zone 'UTC'))::int < 5 then return true; end if;

  -- צעד במסע שהגיע זמנו
  if exists (
    select 1 from journey_enrollments
    where state = 'active' and next_run_at <= soon
  ) then return true; end if;

  -- ניוזלטר שהגיע זמנו, או שנקטע באמצע
  if exists (
    select 1 from newsletters
    where status in ('scheduled', 'sending') and scheduled_at <= soon
  ) then return true; end if;

  -- תזכורת לאירוע שהגיעה ועוד לא נשלחה
  if exists (
    select 1
    from event_reminders r
    join events e on e.id = r.event_id and e.active
    join event_registrations g on g.event_id = e.id and g.stage = 'paid'
    where r.active
      and (case when r.basis = 'event' then e.starts_at else g.paid_at end)
            + make_interval(mins => r.offset_minutes)
          between now() - interval '6 hours' and soon
      and not exists (
        select 1 from event_reminders_sent s
        where s.registration_id = g.id and s.reminder_id = r.id
      )
  ) then return true; end if;

  return false;
exception
  when others then return true;
end;
$$;
revoke all on function crm_cron_due() from public, anon, authenticated;

-- ── המשימה: אותה כתובת ואותו מרווח, עם תנאי ──
do $$
begin
  perform cron.unschedule('crm-cron');
exception
  when others then null;
end $$;

select cron.schedule(
  'crm-cron',
  '*/15 * * * *',
  $job$
    select net.http_get(
      url := 'https://crm-system-eight-omega.vercel.app/api/cron/check-rules',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret'
        )
      ),
      timeout_milliseconds := 120000
    )
    where crm_cron_due();
  $job$
);

-- בדיקה: select crm_cron_due();  — ברוב הרבעים שאינם שעה עגולה אמור לחזור false.
