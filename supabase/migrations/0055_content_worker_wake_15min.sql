-- ── עובד התוכן: התזמון האוטומטי כל 15 דקות במקום כל 5 ─────────────────────────
--
-- 24.11.2026, אחרי המעבר ל-Hobby (תקרה של 4 שעות Active CPU ל-30 יום מתגלגלים).
-- כל השכמה של /api/cron/content-worker עולה כ-2 שניות CPU, גם כשאין מה לעשות.
-- ההשכמה של "תזמון אוטומטי" כל 5 דקות הייתה רוב הקריאות (כ-13 בשעה), כלומר
-- כ-10 דקות CPU ביום. בלעדיה: השגרה של רבע שעה, ועוד השכמות רק סביב פוסט שעולה.
--
-- מה משתנה: שיבוץ ותזמון אוטומטי (autoplan.ts) רץ עכשיו בהשכמה של רבע השעה.
-- כל מה שסביב פוסט שעולה (אוטומציות, הצמדה לפוסט, השומר) עדיין מעיר כל דקה.
--
-- זהה ל-0051 חוץ מהשורה של m % 5. המשימה ב-pg_cron לא משתנה.

create or replace function content_worker_due()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s jsonb;
  tz text;
  lead_min numeric;
  m int := extract(minute from (now() at time zone 'UTC'))::int;
begin
  select value into s from content_meta where key = 'settings';
  tz := coalesce(nullif(s->>'timezone', ''), 'Asia/Jerusalem');
  lead_min := greatest(coalesce((s->>'armLeadMinutes')::numeric, 3), 0);

  -- שגרה (כולל התזמון האוטומטי)
  if m % 15 = 0 then return true; end if;

  -- אוטומציה ברמת החשבון, או יצירה שהתשובה עליה עוד לא ידועה
  if exists (
    select 1 from content_automation_links
    where unlinked_at is null
      and ((status in ('live', 'error') and scope = 'account' and zernio_automation_id is not null)
           or status = 'creating')
  ) then return true; end if;

  -- פוסט שעולה בקרוב או עלה הרגע
  if exists (
    select 1 from content_publications p
    where p.status in ('scheduled', 'publishing', 'partial', 'published', 'unknown')
      and case
        when p.scheduled_for ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
          (left(p.scheduled_for, 16)::timestamp at time zone tz)
            between now() - interval '20 minutes'
                and now() + make_interval(mins => greatest(30, ceil(lead_min)::int + 15))
        else p.status in ('scheduled', 'publishing') and p.updated_at > now() - interval '3 hours'
      end
  ) then return true; end if;

  return false;
exception
  when others then return true;
end;
$$;
revoke all on function content_worker_due() from public, anon, authenticated;
