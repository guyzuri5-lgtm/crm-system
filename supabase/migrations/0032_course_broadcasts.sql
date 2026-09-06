-- ── שליחה חד-פעמית לנרשמות קורס ────────────────────────────────────────────
--
-- מה שלא היה קיים עד כאן: דרך *ידנית* לפנות למי שנרשמה לקורס. שלושת המנועים
-- הקיימים כולם אוטומטיים ואף אחד מהם לא מכסה את זה — מסע נכנסים אליו רק
-- "מתעניינות", כלל אוטומציה מגיב לשינוי סטטוס של איש קשר (וההרשמה לקורס
-- אינה נוגעת בו כלל), ותזכורות קיימות רק לאירועים.
--
-- ── למה טבלה ולא שליחה מיידית מהכפתור ──
-- אותו נימוק כמו בניוזלטר: 200 שליחות לא נכנסות בטיימאאוט של בקשה אחת,
-- ושליחה שנקטעת באמצע בלי שורות נמענים היא שליחה שאי אפשר להמשיך. הכפתור
-- יוצר את השורות, והקרון מוציא אותן — ועוצר וממשיך כמה פעמים שצריך.
--
-- הרצה: Supabase SQL editor, אחרי 0031_journey_entry_pos.sql.

-- ── השליחה ─────────────────────────────────────────────────────────────────
create table course_broadcasts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,

  channel text not null check (channel in ('whatsapp', 'email')),

  -- ── מייל: התוכן נכתב כאן ──
  subject text,
  body text,

  -- ── וואטסאפ: התוכן חי אצל מטא ──
  --
  -- restrict ולא cascade, כמו בתזכורות האירועים: מחיקת תבנית שהיסטוריית
  -- שליחות מצביעה עליה היא תאונה, ועדיף שתיחסם בקול.
  template_id uuid references message_templates (id) on delete restrict,

  -- אילו שלבים נכללו ברגע השליחה. נשמר לתצוגה בהיסטוריה ולא לשליפה חוזרת:
  -- הנמענות עצמן כבר קפואות ב-course_broadcast_recipients, ומי שתעבור שלב
  -- מחר לא אמורה לשנות למפרע את מה שכתוב שנשלח אליה.
  stages text[] not null,

  status text not null default 'sending' check (status in ('sending', 'sent')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now(),

  -- שני מודלי תוכן, ובדיוק אחד מהם בכל שורה.
  --
  -- ההבדל אינו גחמה אלא הכלל של מטא: מחוץ לחלון 24 השעות היא שולחת אך ורק
  -- תבנית שאישרה, עם הטקסט *שאושר*. שדה טקסט חופשי לוואטסאפ היה שקר — גיא
  -- היה כותב בו, והלקוחה הייתה מקבלת משהו אחר. במייל אין מגבלה כזו, ולכן שם
  -- כותבים ישירות. אותה החלטה בדיוק כמו ב-0027 לתזכורות.
  constraint course_broadcasts_content_check check (
    (channel = 'email'
      and subject is not null and body is not null and template_id is null)
    or
    (channel = 'whatsapp'
      and template_id is not null and subject is null and body is null)
  )
);

-- הקרון שואל בכל ריצה "מה עוד באמצע". אינדקס חלקי, כי שליחה שהסתיימה לא
-- מעניינת אותו יותר לעולם.
create index course_broadcasts_sending_idx
  on course_broadcasts (created_at) where status = 'sending';

-- מסך הקורס מציג את ההיסטוריה שלו.
create index course_broadcasts_course_idx on course_broadcasts (course_id, created_at desc);

-- ── מי מקבלת ───────────────────────────────────────────────────────────────
--
-- תמונת מצב שנוצרת ברגע הלחיצה, ולא שאילתה שרצה מחדש בכל ריצת קרון. מי
-- שתירשם בזמן שהשליחה באוויר לא תיכנס אליה באמצע — וזה הנכון: "שלחתי ל-47"
-- חייב להישאר נכון גם מחר.
--
-- המפתח הראשי המורכב הוא מה שמונע שליחה כפולה, בדיוק כמו ב-event_reminders_sent.
create table course_broadcast_recipients (
  broadcast_id uuid not null references course_broadcasts (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  primary key (broadcast_id, contact_id)
);

-- "מי עוד לא קיבלה בשליחה הזו" — השאילתה היחידה שהמנוע מריץ בלולאה.
create index course_broadcast_recipients_pending_idx
  on course_broadcast_recipients (broadcast_id) where status = 'pending';

-- ── RLS ────────────────────────────────────────────────────────────────────
-- הצוות בלבד. אין כאן שום מסלול ציבורי — להבדיל מ-courses עצמה, שדף ההרשמה
-- קורא דרך service role.
alter table course_broadcasts            enable row level security;
alter table course_broadcast_recipients  enable row level security;

create policy "team reads course broadcasts"  on course_broadcasts
  for select to authenticated using (true);
create policy "team writes course broadcasts" on course_broadcasts
  for all    to authenticated using (true) with check (true);
create policy "team reads broadcast recipients"  on course_broadcast_recipients
  for select to authenticated using (true);
create policy "team writes broadcast recipients" on course_broadcast_recipients
  for all    to authenticated using (true) with check (true);

comment on table course_broadcasts is
  'שליחה חד-פעמית וידנית לנרשמות קורס. מייל = תוכן חופשי, וואטסאפ = תבנית מאושרת.';
comment on table course_broadcast_recipients is
  'תמונת מצב של הנמענות ברגע הלחיצה. המפתח המורכב מונע שליחה כפולה.';
