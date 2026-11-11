-- ── סנכרון אירועים וקורסים לאתר הוורדפרס (spiritualguy.co.il) ─────────────
--
-- ה-CRM הוא המקור, והאתר מתעדכן ממנו: כל שמירה של אירוע או קורס, וכל תשלום
-- שמוריד מקום פנוי, דוחפים את השורה לפוסט המקביל (סוג תוכן event / course).
--
-- ── פעיל = מפורסם באתר ──
-- החלטה של גיא (14.10.26): אין מתג פרסום נפרד. active=true → status=publish,
-- active=false → draft. מכאן גם שינוי ברירת המחדל בסוף הקובץ: אירוע או קורס
-- חדש נוצר כבוי, כדי ששמירה ראשונה לא תפרסם אותו לאתר לפני שהוא מוכן.
--
-- ── למה דגל "צריך סנכרון" ולא ניסיון אחד ──
-- הסנכרון רץ ברקע אחרי השמירה (after), כדי שוורדפרס איטי לא יעכב את ה-CRM
-- ולא יכשיל תשלום. אם האתר לא ענה, הדגל נשאר דלוק והקרון מנסה שוב כל רבע
-- שעה. wp_sync_requested_at הוא מה שמונע מהקרון להתנגש בסנכרון שעוד רץ:
-- הוא נוגע רק בשורות שהבקשה שלהן ישנה מכמה דקות.

-- ── אירועים ────────────────────────────────────────────────────────────────
alter table events add column if not exists ends_at timestamptz;          -- null = לא נקבעה שעת סיום
alter table events add column if not exists price numeric;                -- ₪
alter table events add column if not exists short_description text;       -- לכרטיס באתר
alter table events add column if not exists wp_post_id bigint;            -- הפוסט המקביל באתר
alter table events add column if not exists wp_sync_pending boolean not null default false;
alter table events add column if not exists wp_sync_requested_at timestamptz;
alter table events add column if not exists wp_sync_error text;           -- השגיאה האחרונה, ריק = תקין
alter table events add column if not exists wp_synced_at timestamptz;

-- פוסט אחד, אירוע אחד: שני אירועים שמצביעים על אותו פוסט היו דורסים זה את זה.
create unique index if not exists events_wp_post_id_idx on events (wp_post_id) where wp_post_id is not null;
create index if not exists events_wp_sync_pending_idx on events (wp_sync_requested_at) where wp_sync_pending;

-- ── קורסים ─────────────────────────────────────────────────────────────────
alter table courses add column if not exists price numeric;               -- ₪
alter table courses add column if not exists short_description text;      -- לכרטיס באתר
alter table courses add column if not exists wp_post_id bigint;
alter table courses add column if not exists wp_sync_pending boolean not null default false;
alter table courses add column if not exists wp_sync_requested_at timestamptz;
alter table courses add column if not exists wp_sync_error text;
alter table courses add column if not exists wp_synced_at timestamptz;

create unique index if not exists courses_wp_post_id_idx on courses (wp_post_id) where wp_post_id is not null;
create index if not exists courses_wp_sync_pending_idx on courses (wp_sync_requested_at) where wp_sync_pending;

-- ── הרשמה שנולדה מתשלום ──
-- מי ששילם בגרואו על אירוע בלי לעבור בטופס נרשם מהתשלום עצמו (lib/grow.ts),
-- וזה המקור שלו — לא "דף הרשמה" ולא "ידני".
alter table event_registrations drop constraint if exists event_registrations_source_check;
alter table event_registrations add constraint event_registrations_source_check
  check (source in ('landing', 'meta', 'manual', 'grow'));

-- ── חדש = כבוי עד שמדליקים ──
-- השורות הקיימות לא משתנות; רק מה שייווצר מעכשיו.
alter table events  alter column active set default false;
alter table courses alter column active set default false;

-- ── קורס המדיטציה ↔ הטיוטה 2614 באתר ──
-- הקישור בלבד, בלי לסמן "צריך סנכרון": הדחיפה הראשונה נעשית ידנית ונבדקת.
update courses set wp_post_id = 2614, price = coalesce(price, 88)
where slug = 'meditation' and wp_post_id is null;

comment on column events.wp_post_id is 'מזהה הפוסט (event) באתר הוורדפרס. נקבע ביצירה הראשונה או בקישור ידני.';
comment on column courses.wp_post_id is 'מזהה הפוסט (course) באתר הוורדפרס. נקבע ביצירה הראשונה או בקישור ידני.';
