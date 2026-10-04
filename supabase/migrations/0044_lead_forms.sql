-- 0044 — ליד מטופס לידים עומד בפני עצמו, בלי קורס ובלי אירוע.
--
-- עד היום ליד ממטא היה חייב להיות משויך לקורס או לאירוע (meta_form_targets),
-- ובלי שיוך הוא נעצר ב-webhook_inbox עם הודעה. זה נכון לקמפיין שמוכר מוצר
-- מסוים, ושגוי לקמפיין "השאר פרטים" — שהוא בדיוק מה שגיא מפרסם.
--
-- שתי טבלאות, וההפרדה ביניהן היא העיקר:
--
--   meta_lead_forms — הטופס עצמו. **נרשם מעצמו בליד הראשון שמגיע ממנו**,
--     ולכן אין מסך שצריך להקדים אותו ואין מספר שצריך להעתיק מידנית. מטא לא
--     שולחת את *שם* הטופס ב-webhook (רק מזהה), ושליפתו מ-Graph דורשת הרשאת
--     pages_manage_ads שאין לנו — ולכן name מתחיל ריק, והמסך מציג את המזהה
--     עד שגיא נותן לו שם.
--
--   meta_form_leads — מי השאיר פרטים, מאיזה טופס ומתי. זה הקהל שמסע
--     מסוג lead_form מצרף.
--
-- ייחוד על (form_id, contact_id) ולא על הליד: מי שממלא את אותו טופס פעמיים
-- הוא אדם אחד, ו-created_at צריך להישאר של הפעם הראשונה — אחרת מילוי חוזר
-- היה מחזיר אותו לתחילת המסע.
--
-- הטריגר החדש lead_form מסונן בזמן (ראו enrollForJourney), בדיוק כמו
-- course_paid ומאותה סיבה: "השאיר פרטים" הוא מצב קבוע שלא יוצאים ממנו.
-- בלי הסינון, הדלקת מסע הייתה שולחת "נעים להכיר" לכל ליד שנקלט אי־פעם.

create table if not exists meta_lead_forms (
  form_id text primary key,
  -- שם קריא שגיא נותן ידנית. ריק = המסך מציג את המזהה.
  name text,
  first_seen_at timestamptz not null default now(),
  last_lead_at timestamptz
);

comment on table meta_lead_forms is
  'טפסי לידים של מטא שנקלטו. נרשמים מעצמם בליד הראשון; name נכתב ידנית כי מטא לא שולחת אותו.';

create table if not exists meta_form_leads (
  id uuid primary key default gen_random_uuid(),
  form_id text not null references meta_lead_forms(form_id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  -- מזהה הליד אצל מטא. null כשהליד נקלט מייבוא קובץ ולא מה-webhook.
  leadgen_id text,
  -- התשובות כפי שמטא שלחה אותן, לפי שמות השדות שלה.
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists meta_form_leads_form_contact_key
  on meta_form_leads (form_id, contact_id);
create unique index if not exists meta_form_leads_leadgen_key
  on meta_form_leads (leadgen_id) where leadgen_id is not null;
create index if not exists meta_form_leads_form_created_idx
  on meta_form_leads (form_id, created_at desc);
create index if not exists meta_form_leads_contact_idx
  on meta_form_leads (contact_id);

comment on table meta_form_leads is
  'מי השאיר פרטים בטופס לידים. הקהל של מסע מסוג lead_form.';

-- ── הטריגר החדש ──
alter table journeys drop constraint if exists journeys_entry_type_check;
alter table journeys
  add constraint journeys_entry_type_check
  check (entry_type in (
    'status', 'quiz', 'booking',
    'event_interest', 'course_interest', 'course_paid',
    -- entry_value: {"form_id":"…"} לטופס מסוים, או {} לכל טופס לידים.
    'lead_form'
  ));

comment on column journeys.entry_value is
  'status | event_id | course_id | form_id, לפי entry_type. אובייקט ריק כשאין ערך — ובמסע lead_form פירושו "כל טופס".';
