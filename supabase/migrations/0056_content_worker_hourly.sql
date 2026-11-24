-- ── עובד התוכן: שגרה פעם בשעה, ושיבוץ בתוך דקה משינוי בלוח ──────────────────
--
-- 24.11.2026, אחרי המעבר ל-Hobby בורסל (4 שעות Active CPU ל-30 יום מתגלגלים).
-- כל השכמה של /api/cron/content-worker עולה כ-2 שניות CPU גם בלי עבודה, ולכן
-- מה שקובע את הצריכה הוא מספר ההשכמות. מחליף את 0055 (שגרה כל רבע שעה).
--
-- מתי המסד מעיר את העובד:
--  - בשעה העגולה (UTC): השגרה — סטטוסים, חשבונות, מספרים ומיילים → אנשי קשר,
--    ושיבוץ כרשת ביטחון. גיא אישר שמייל מתגובה ייכנס ל-CRM עד שעה אחרי;
--  - כשיש דגל autoplan_dirty והמתג "תזמון אוטומטי" דלוק: כל כתיבה דרך ה-API של
--    הגאנט או של הקליטה מסמנת אותו (autoplan.ts, markAutoplanDirty), והעובד מוחק
--    אותו ומשבץ. סרטון חדש משתבץ בתוך דקה, בלי השכמה כל 5 דקות;
--  - בלי שינוי: אוטומציה ברמת החשבון, וחלון הפרסום (כל דקה).
--
-- המשימה ב-pg_cron לא משתנה. להריץ אחרי שהקוד שמסמן את הדגל נפרס.

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
  if m = 0 then return true; end if;

  -- הלוח השתנה ומחכה לשיבוץ
  if coalesce((s->>'autoSchedule')::boolean, false)
     and exists (select 1 from content_meta where key = 'autoplan_dirty') then
    return true;
  end if;

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
