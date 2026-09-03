-- הוספת event_registered לתצוגת הפעילות.
--
-- אותו סיפור בדיוק כמו 0014, ובאותה סיבה שהיא עצמה חזתה: 0012 קבעה רשימה
-- קשיחה של "מה שהלקוח יזם", וכל סוג אינטראקציה חדש מחייב לגעת גם כאן וגם
-- ב-ACTIVITY_LABELS בקוד. הרשימה הכפולה היא נקודת התורפה של המבנה הזה.
--
-- בלי המיגרציה הזו, מי שנרשמה לאירוע לא הייתה מופיעה ב"לקוחות פעילים" —
-- ודווקא היא הליד החם ביותר שיש: היא לא רק השאירה פרטים, היא יצאה לתשלום.
--
-- חייבת לרוץ **אחרי** 0025, שיוצרת את הערך event_registered ב-enum.

drop view if exists contact_activity;

create view contact_activity as
select
  agg.contact_id,
  agg.last_any_at,
  agg.last_customer_at,
  agg.last_inbound_at,
  agg.inbound_count,
  last_inbound.content as last_inbound_text,
  last_customer.type   as last_customer_type,
  last_any.type        as last_any_type
from (
  select
    contact_id,
    max(created_at) as last_any_at,
    max(created_at) filter (
      where type in (
        'whatsapp_in', 'quiz_submitted', 'course_lead', 'event_registered',
        'booking_created', 'booking_cancelled'
      )
    ) as last_customer_at,
    max(created_at) filter (where type = 'whatsapp_in') as last_inbound_at,
    (count(*) filter (where type = 'whatsapp_in'))::int  as inbound_count
  from interactions
  group by contact_id
) agg

left join lateral (
  select i.content
  from interactions i
  where i.contact_id = agg.contact_id and i.type = 'whatsapp_in'
  order by i.created_at desc
  limit 1
) last_inbound on true

left join lateral (
  select i.type
  from interactions i
  where i.contact_id = agg.contact_id
    and i.type in (
      'whatsapp_in', 'quiz_submitted', 'course_lead', 'event_registered',
      'booking_created', 'booking_cancelled'
    )
  order by i.created_at desc
  limit 1
) last_customer on true

left join lateral (
  select i.type
  from interactions i
  where i.contact_id = agg.contact_id
  order by i.created_at desc
  limit 1
) last_any on true;

comment on view contact_activity is
  'סיכום פעילות לכל איש קשר עבור עמוד "לקוחות פעילים". last_customer_* סופר רק מה שהלקוח יזם.';
