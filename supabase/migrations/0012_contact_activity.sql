-- ── contact_activity ───────────────────────────────────────────────────────
--
-- תצוגה שמסכמת לכל איש קשר מה קרה איתו לאחרונה, בשביל עמוד "לקוחות פעילים".
--
-- למה תצוגה ולא שאילתה מהקוד: העמוד צריך, לכל איש קשר, את *השורה האחרונה*
-- מתוך interactions — לא ספירה ולא סכום. בלי זה הקוד היה נאלץ לשלוף את כל
-- ההיסטוריה ולסנן בזיכרון, וזה מתדרדר ככל שההודעות מצטברות. פוסטגרס עושה את
-- זה עם DISTINCT ON כמעט בחינם.
--
-- ההבחנה שקובעת מי "פעיל": מה שהלקוח יזם מול מה שאנחנו יזמנו. מייל שיצא אל
-- מישהו שמעולם לא ענה אינו סימן לעניין — הוא סימן לכך שניסינו. לכן
-- last_customer_at מתעלם מ-whatsapp_out, email_out ו-manual_note, ולצידו יש
-- last_any_at לתצוגה מלאה כשמדליקים את המתג בעמוד.

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
      where type in ('whatsapp_in', 'quiz_submitted', 'booking_created', 'booking_cancelled')
    ) as last_customer_at,
    max(created_at) filter (where type = 'whatsapp_in') as last_inbound_at,
    (count(*) filter (where type = 'whatsapp_in'))::int  as inbound_count
  from interactions
  group by contact_id
) agg

-- שלוש ה-lateral האלה שולפות את השורה האחרונה בכל חתך. הן נראות חוזרות על
-- עצמן, אבל כל אחת עונה על שאלה אחרת: מה הלקוח כתב, מה הוא עשה, ומה קרה בכלל.
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
    and i.type in ('whatsapp_in', 'quiz_submitted', 'booking_created', 'booking_cancelled')
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

-- האינדקס הזה הוא מה שהופך את ה-lateral לזולות: בלעדיו כל אחת מהן סורקת את כל
-- הטבלה כדי למצוא שורה אחת.
create index if not exists interactions_contact_created_idx
  on interactions (contact_id, created_at desc);
