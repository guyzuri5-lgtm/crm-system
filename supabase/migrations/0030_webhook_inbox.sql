-- ── תיבת דואר נכנס ל-webhooks ושיוך טפסי מטא ───────────────────────────────
--
-- שני ה-webhooks שנבנים בשלב 6 — לידים ממטא ותשלומים מגרואו — שונים מכל מה
-- שקדם להם בדבר אחד: **איננו יודעים איך ה-payload שלהם באמת נראה**. המבנה
-- של מטא מתועד אך משתנה בין טפסים (שמות השדות נקבעים על ידי מי שבנה את
-- הטופס), והמבנה של גרואו לא נבדק כאן מעולם.
--
-- מכאן הטבלה הראשונה: כל payload נשמר *לפני* שמנסים להבין אותו. עיבוד שנכשל
-- משאיר את המידע הגולמי במקום שאפשר לפתוח ולקרוא, במקום 500 בלוג של ורסל
-- ולקוחה שנעלמה. זה ההבדל בין "הטופס החדש לא נקלט, אין לי מושג למה" לבין
-- "הנה בדיוק מה שמטא שלחה".
--
-- הרצה: Supabase SQL editor, אחרי 0029_activity_course.sql.

-- ── התיבה ──────────────────────────────────────────────────────────────────

create table webhook_inbox (
  id uuid primary key default gen_random_uuid(),

  -- 'meta' | 'grow' היום. **בכוונה בלי check constraint**: כל תפקידה של
  -- הטבלה הזו הוא לא לאבד מידע, ואילוץ שיכול להפיל את ה-insert של רשת
  -- הביטחון עצמה סותר את הסיבה שבגללה היא קיימת. הערך נכתב על ידי הקוד שלנו
  -- ולא מגיע מה-payload, ולכן אין כאן קלט לא-מהימן להגן מפניו.
  source text not null,

  payload jsonb not null,

  -- false = טרם עובד או שהעיבוד נכשל. שתי המשמעויות מכוונות: שתיהן אומרות
  -- "יש כאן משהו שדורש מבט אנושי", וזו השאלה היחידה שמסך ההגדרות שואל.
  processed boolean not null default false,

  -- למה זה לא עובד. ריק בשורה שעברה בהצלחה או שעוד לא נגעו בה.
  error text,

  created_at timestamptz not null default now()
);

-- מסך ההגדרות שואל שאלה אחת: "מה תקוע". אינדקס חלקי, ולכן הוא נשאר קטן גם
-- כשבתיבה יש עשרות אלפי שורות מעובדות.
create index webhook_inbox_pending_idx on webhook_inbox (source, created_at desc)
  where not processed;

-- ── לאיזה אירוע או קורס שייך הטופס ─────────────────────────────────────────
--
-- ב-webhook של leadgen מטא שולחת מזהה טופס ותו לא. אין בו שם, אין בו קמפיין,
-- ואין שום דרך להסיק ממנו לאיזה מוצר הליד נרשם — השיוך הזה קיים רק בראש של
-- מי שבנה את הקמפיין. הטבלה הזו היא המקום שבו הוא נאמר בקול.
create table meta_form_targets (
  -- מזהה הטופס אצל מטא. text ולא bigint: המזהים של מטא הם מספרים ארוכים
  -- שמגיעים ב-JSON כמחרוזות, והמרה שלהם למספר היא בדיוק המקום שבו הספרה
  -- האחרונה נופלת בשקט.
  form_id text primary key,

  target_type text not null check (target_type in ('event', 'course')),

  -- **בלי מפתח זר, ובמודע.** מפתח זר אינו יכול להצביע על שתי טבלאות, ופיצול
  -- לשתי עמודות nullable היה מזמין את השורה שבה שתיהן ריקות. המחיר: יעד
  -- שנמחק משאיר שיוך יתום — ולכן מסך ההגדרות מציג "היעד נמחק" במקום שם,
  -- במקום להיעלם בשקט.
  target_id uuid not null,

  -- שם הטופס כפי שהוא מוכר לגיא ("הרשמה לערב פתיחה — קהל קר"). מטא לא שולחת
  -- אותו ב-webhook, ולכן הוא נכתב ידנית וקיים רק כדי שהמסך יהיה קריא.
  label text,

  created_at timestamptz not null default now()
);

-- "אילו טפסים מפנים לאירוע שאני עומד למחוק" — השאילתה שמסך ההגדרות מריץ.
create index meta_form_targets_target_idx on meta_form_targets (target_type, target_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- הצוות בלבד. ה-webhooks עצמם כותבים דרך service role בצד השרת, אותו דפוס
-- כמו כל שאר הקליטה החיצונית במערכת.
alter table webhook_inbox      enable row level security;
alter table meta_form_targets  enable row level security;

create policy "team reads webhook inbox"    on webhook_inbox     for select to authenticated using (true);
create policy "team writes webhook inbox"   on webhook_inbox     for all    to authenticated using (true) with check (true);
create policy "team reads meta form targets" on meta_form_targets for select to authenticated using (true);
create policy "team writes meta form targets" on meta_form_targets for all   to authenticated using (true) with check (true);

comment on table webhook_inbox is
  'כל payload שנקלט מ-webhook חיצוני, גולמי, לפני עיבוד. processed=false = דורש מבט.';
comment on table meta_form_targets is
  'שיוך מזהה טופס אצל מטא לאירוע או לקורס. בלי זה ליד נכנס לא יודע לאן הוא שייך.';
