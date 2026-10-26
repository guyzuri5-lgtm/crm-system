-- ── עובד הרקע של גאנט התוכן: התעוררות חכמה ────────────────────────────────────
--
-- מחליף את התזמון של 0046. עד עכשיו pg_cron קרא ל-/api/cron/content-worker כל
-- דקה: כ-43 אלף קריאות בחודש, כל אחת הפעלה של פונקציה ב-Vercel, וזה מה שגמר
-- את מכסת ה-Active CPU. ברוב הדקות לא היה שם מה לעשות.
--
-- עכשיו המשימה עדיין רצה כל דקה, אבל בתוך המסד (בחינם), ובודקת אם יש סיבה
-- להעיר את העובד. היא קוראת לו רק כש:
--  - יש אוטומציה ברמת החשבון (live/error) או אוטומציה שבאמצע יצירה (creating).
--    אסור שאוטומציה תישאר ברמת החשבון, ולכן אלה מקבלות קריאה כל דקה;
--  - יש פוסט שעולה בעוד פחות מ-30 דקות (או armLeadMinutes + 15, הגדול מביניהם)
--    או שהיה אמור לעלות ב-20 הדקות האחרונות. זה מכסה את יצירת האוטומציה לפני
--    הפרסום (armDue), את השומר שמבטל פוסט בלי אוטומציה (guardAutomations),
--    ואת ההצמדה לפוסט אחרי שהוא עולה;
--  - הדקה מתחלקת ב-15 — המשימות השגרתיות (סטטוס, חשבונות, מספרים, פיסות);
--  - או מתחלקת ב-5, כשהמתג "תזמון אוטומטי" דלוק (autoplan רץ פעם ב-5 דקות).
-- כל שגיאה בבדיקה — מעירה. עדיף קריאה מיותרת מאוטומציה שנשארה ברמת החשבון.
--
-- scheduled_for הוא טקסט בשעון מקומי (YYYY-MM-DDTHH:MM). העובד מתרגם אותו לפי
-- אזור הזמן שבהגדרות (content_meta 'settings'), ולכן גם הבדיקה כאן.
--
-- הסוד: אותו crm_cron_secret מה-vault כמו ב-0043 ו-0046 — אין סוד חדש.
-- להריץ אחרי שהקוד שבו ה-tick-ים קצרים מעט מ-5 ו-15 דקות נפרס (worker.ts).

create extension if not exists pg_cron;
create extension if not exists pg_net;

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

  -- שגרה
  if m % 15 = 0 then return true; end if;
  if m % 5 = 0 and coalesce((s->>'autoSchedule')::boolean, false) then return true; end if;

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
        -- בלי מועד קריא: מעירים, אבל רק כשהשורה השתנתה לאחרונה, כדי ששורה
        -- ישנה ופגומה לא תחזיר את הקריאה כל דקה לתמיד
        else p.status in ('scheduled', 'publishing') and p.updated_at > now() - interval '3 hours'
      end
  ) then return true; end if;

  return false;
exception
  when others then return true;
end;
$$;
revoke all on function content_worker_due() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('content-worker');
exception
  when others then null;
end $$;

select cron.schedule(
  'content-worker',
  '* * * * *',
  $job$
    select net.http_get(
      url := 'https://crm-system-eight-omega.vercel.app/api/cron/content-worker',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret'
        )
      ),
      timeout_milliseconds := 90000
    )
    where content_worker_due();
  $job$
);
