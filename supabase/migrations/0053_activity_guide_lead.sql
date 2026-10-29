-- guide_lead בתצוגת הפעילות, ותיקון הרישומים שכבר נכתבו כ-course_lead.
--
-- חייבת לרוץ **אחרי** 0052, שיוצרת את הערך guide_lead ב-enum.
--
-- שני שינויים בתצוגה:
--   1. guide_lead נכנס לרשימת "מה שהלקוח יזם" — בלי זה מי שפתח מדריך לא
--      מופיע ב"לקוחות פעילים". הרשימה חיה גם ב-ACTIVITY_LABELS שב-TypeScript
--      (ר' ההערה ב-0029): כל סוג חדש מחייב לגעת בשניהם.
--   2. last_customer_text — התוכן של הפעולה האחרונה שהלקוח יזם. ממנו נלקח
--      שם המדריך ("השאיר פרטים למדריך · מדריך לאיזון הצ׳אקרות").

drop view if exists contact_activity;

create view contact_activity as
select
  agg.contact_id,
  agg.last_any_at,
  agg.last_customer_at,
  agg.last_inbound_at,
  agg.inbound_count,
  last_inbound.content  as last_inbound_text,
  last_customer.type    as last_customer_type,
  last_customer.content as last_customer_text,
  last_any.type         as last_any_type
from (
  select
    contact_id,
    max(created_at) as last_any_at,
    max(created_at) filter (
      where type in (
        'whatsapp_in', 'quiz_submitted', 'course_lead', 'guide_lead', 'event_registered',
        'course_registered', 'booking_created', 'booking_cancelled'
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
  select i.type, i.content
  from interactions i
  where i.contact_id = agg.contact_id
    and i.type in (
      'whatsapp_in', 'quiz_submitted', 'course_lead', 'guide_lead', 'event_registered',
      'course_registered', 'booking_created', 'booking_cancelled'
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

-- ── תיקון רטרואקטיבי ────────────────────────────────────────────────────────
--
-- רק מה שנכתב ע"י /api/leads/website: course_lead שהשורה הראשונה שלו היא
-- "נרשם באתר — <מדריך> (<slug>)" או "פתח מדריך נוסף באתר — ...". לידים
-- ממטא ("השאיר פרטים בטופס לידים במטא") והרשמות לקורס לא נוגעים.
--
-- התוכן עובר לפורמט החדש: שם המדריך בשורה הראשונה (זה מה שמוצג ברשימה
-- ובכרטיס), ואחריו מה שהיה — כולל ה-slug, ההסכמה והדף. שום פרט לא נמחק.
update interactions
set
  type = 'guide_lead',
  content = regexp_replace(
    content,
    '^(נרשם|פתח מדריך נוסף) באתר — ([^\n]*) \(([a-z0-9-]+)\)',
    E'\\2\n\\1 באתר (\\3)'
  )
where type = 'course_lead'
  and content ~ '^(נרשם|פתח מדריך נוסף) באתר — [^\n]* \([a-z0-9-]+\)';

-- ואם הקוד החדש כבר רץ לפני 0052, הוא רשם בפורמט החדש אבל בסוג הישן
-- (הנפילה ל-course_lead ב-route.ts). אלה רק מחליפים סוג.
update interactions
set type = 'guide_lead'
where type = 'course_lead'
  and content ~ '^[^\n]*\n(נרשם|פתח מדריך נוסף) באתר \([a-z0-9-]+\)';
