-- ── קורסים דיגיטליים ───────────────────────────────────────────────────────
--
-- קורס הוא אירוע בלי תאריך. זה נשמע כמו הבדל קטן, והוא מוחק כאן ארבעה
-- מנגנונים שלמים: אין קיבולת (מוצר דיגיטלי לא נגמר במלאי), אין תזכורות
-- ("יום לפני" מה?), אין כפתורי הוספה ליומן, ואין מתגי "הצג תאריך/מקומות".
-- מה שנשאר זהה — שדות העיצוב של דף ההרשמה ודף התודה — נשאר זהה *במכוון*,
-- כדי ששני סוגי הדפים יוכלו לחלוק את אותם רכיבי תצוגה בקוד.
--
-- הרצה: Supabase SQL editor, אחרי 0027_event_reminders.sql.
-- **חובה להריץ את 0029 מיד אחריה** — היא משלימה את תצוגת הפעילות, ואי אפשר
-- היה לאחד אותן (ההסבר בגוף המיגרציה, ליד ה-enum).

-- ── סוג אינטראקציה חדש ליומן איש הקשר ──────────────────────────────────────
--
-- interaction_type הוא **enum** ולא text. זו המלכודת שהפילה את 0024: כתיבה
-- ליומן עם ערך שאינו ב-enum נכשלת *בשקט*, כי הקוד לא בודק את שגיאת ה-insert.
-- התוצאה שם: ההרשמות נקלטו והיומן נשאר ריק, בלי שגיאה ובלי שאיש ידע.
--
-- הערך אינו בשימוש במיגרציה הזו בכוונה — פוסטגרס אוסר להשתמש בערך enum
-- באותה טרנזקציה שבה הוא נוסף. לכן עדכון תצוגת contact_activity, שכן משתמשת
-- בו, יושב ב-0029 נפרדת. בדיוק כפי ש-0013/0014 ו-0025/0026 נחלקו לפניה.
alter type interaction_type add value if not exists 'course_registered';

-- ── טריגר כניסה חדש למסע ───────────────────────────────────────────────────
--
-- journeys.entry_type הוא text עם check constraint (0016, הורחב ב-0025).
-- בלי ההרחבה כאן, מסע עם הטריגר "נרשמה כמתעניינת לקורס" נדחה על ידי המסד —
-- כלומר הכפתור בממשק פשוט לא היה עובד.
alter table journeys drop constraint if exists journeys_entry_type_check;

alter table journeys add constraint journeys_entry_type_check
  check (entry_type in (
    'status', 'quiz', 'booking', 'course_lead', 'event_interest', 'course_interest'
  ));

comment on column journeys.entry_type is
  'status | quiz | booking | course_lead | event_interest | course_interest. '
  'ל-status, event_interest ו-course_interest יש ערך נלווה ב-entry_value.';

-- ── הקורס ──────────────────────────────────────────────────────────────────

create table courses (
  id uuid primary key default gen_random_uuid(),
  -- הכתובת הציבורית: /course/{slug}. ייחודי, כי הוא המפתח שהקהל מגיע דרכו.
  slug text not null unique,
  name text not null,                            -- גם הכותרת הראשית בדף ההרשמה
  subtitle text,                                 -- כותרת משנה מתחת לכותרת
  description text,
  grow_link text,                                -- לינק תשלום מגרואו

  -- [{key,label,type:'text'|'select',options:[]}] — שדות הטופס המותאמים.
  -- אותו מבנה בדיוק כמו events.custom_fields, ומאותה סיבה: הם נקראים ונכתבים
  -- תמיד יחד עם הקורס, בסדר שנקבע בעורך.
  custom_fields jsonb not null default '[]'::jsonb,

  -- ── עיצוב דף ההרשמה ──
  header_image_url text,                         -- תמונת רקע לחלק העליון (באקט media, 0023)
  form_description text,                         -- תיאור קצר בתוך הטופס
  button_text text not null default 'המשך לתשלום מאובטח בגרואו',

  -- ── עיצוב דף התודה ──
  -- אין thankyou_show_calendar: אין תאריך, אין מה להוסיף ליומן.
  thankyou_title text not null default 'ההרשמה נקלטה!',
  thankyou_text text,
  thankyou_show_image boolean not null default false,

  -- ── חיבור לדף הנחיתה הישן ──
  --
  -- ל-webhook הקיים ב-/api/webhooks/course אין מושג על הטבלה הזו — הוא נבנה
  -- ב-0013 מול course_leads וממשיך לעבוד בדיוק כמו שהוא. הדגל הזה הוא הגשר:
  -- ליד שנקלט בו יירשם *גם* כמתעניין בקורס המסומן, אם יש כזה.
  --
  -- למה בדיוק אחד: ל-webhook יש כתובת אחת ואין בו שדה שמזהה לאיזה קורס
  -- הליד שייך. שני קורסים מסומנים היו הופכים את השיוך לניחוש.
  legacy_webhook boolean not null default false,

  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- אכיפה של "קורס אחד לכל היותר" ברמת המסד ולא בקוד. אינדקס ייחודי על ביטוי
-- קבוע עם תנאי חלקי: כל השורות המסומנות מתנגשות זו בזו, ולא-מסומנות אינן
-- נכנסות לאינדקס כלל. בלי זה, שתי לשוניות פתוחות בו-זמנית היו יכולות לסמן שני
-- קורסים, וההודעה הראשונה מדף הנחיתה הייתה נוחתת באחד מהם באקראי.
create unique index courses_single_legacy_webhook_idx on courses ((true)) where legacy_webhook;

-- ── מי נרשם ────────────────────────────────────────────────────────────────
--
-- זהה במבנה ל-event_registrations, ובכוונה: אותם שלושה שלבים, אותו כלל
-- "השלב עולה בדרגה בלבד", ואותם מקורות. טבלה נפרדת ולא עמודה nullable על
-- event_registrations, כי מפתח זר לא יכול להצביע על שתי טבלאות, ו-check
-- constraint שמוודא "בדיוק אחד מהשניים מלא" הוא בדיוק סוג הכלל שנשכח.
create table course_registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  stage text not null default 'interested'
    check (stage in ('interested', 'registered', 'paid')),
  source text not null default 'landing'
    check (source in ('landing', 'meta', 'manual', 'legacy')),
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  -- אדם אחד, רישום אחד לקורס.
  unique (course_id, contact_id)
);

-- ── אינדקסים ───────────────────────────────────────────────────────────────

-- מסך הקורס ומוני הדשבורד סופרים לפי קורס ולפי שלב.
create index course_registrations_course_idx on course_registrations (course_id, stage);

-- כרטיסיית איש הקשר מציגה לאילו קורסים הוא רשום.
create index course_registrations_contact_idx on course_registrations (contact_id);

-- ה-webhook הישן שואל בכל ליד "האם יש קורס מסומן". אינדקס חלקי, שורה אחת.
create index courses_legacy_lookup_idx on courses (id) where legacy_webhook and active;

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- הצוות בלבד. דף ההרשמה הציבורי אינו נשען על כך — הוא קורא וכותב דרך
-- service role בצד השרת, אותו דפוס כמו /book ו-/event.
alter table courses               enable row level security;
alter table course_registrations  enable row level security;

create policy "team reads courses"               on courses              for select to authenticated using (true);
create policy "team writes courses"              on courses              for all    to authenticated using (true) with check (true);
create policy "team reads course registrations"  on course_registrations for select to authenticated using (true);
create policy "team writes course registrations" on course_registrations for all    to authenticated using (true) with check (true);

comment on table courses is
  'קורסים דיגיטליים. כמו events אך בלי תאריך, מקום, קיבולת ותזכורות.';
comment on table course_registrations is
  'הרשמות לקורסים. השלב עולה בדרגה בלבד: interested → registered → paid.';
