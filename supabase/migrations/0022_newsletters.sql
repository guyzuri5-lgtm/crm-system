-- ── ניוזלטר ────────────────────────────────────────────────────────────────
--
-- הודעה אחת שיוצאת להרבה אנשים, להבדיל ממסע (רצף לאדם אחד) ומכלל (תגובה
-- לאירוע). לכן טבלאות נפרדות, ולא הרחבה של message_templates.
--
-- ── למה יש טבלת נמענים ולא רק "קהל" ──
-- שליחה ל-200 איש אינה פעולה אטומית: היא נחתכת לאורך כמה ריצות קרון בגלל
-- מכסת Gmail ותקציב הזמן של הפונקציה. בלי שורה לכל נמען אין דרך לדעת מי כבר
-- קיבל, וריצה שנייה הייתה שולחת שוב לכולם. הרשומות נוצרות פעם אחת, בתחילת
-- השליחה — תמונת מצב של הקהל באותו רגע, כך שאיש קשר שנוסף באמצע לא נכנס
-- לשליחה שכבר רצה.

create table newsletters (
  id uuid primary key default gen_random_uuid(),
  subject text not null,

  -- [{type:'text',html}] | [{type:'image',url,alt}] | [{type:'youtube',videoId,caption}]
  blocks jsonb not null default '[]'::jsonb,

  -- {"type":"all"} או {"type":"statuses","statuses":[...]}
  audience jsonb not null default '{"type":"all"}'::jsonb,

  -- draft → scheduled → sending → sent, או canceled לפני שהתחילה השליחה.
  -- "שלח עכשיו" נכנס כ-scheduled עם scheduled_at=now() ולא שולח מהדפדפן:
  -- 200 שליחות לא נכנסות בטיימאאוט של בקשה אחת.
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'canceled')),
  scheduled_at timestamptz,

  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now()
);

create table newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid not null references newsletters (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  error text,
  -- המפתח שמונע שליחה כפולה לאותו אדם באותו ניוזלטר.
  unique (newsletter_id, contact_id)
);

-- הקרון שואל בכל ריצה "מי עוד לא קיבל" — אינדקס חלקי, כי pending נעלם עם הזמן.
create index newsletter_recipients_pending_idx
  on newsletter_recipients (newsletter_id)
  where status = 'pending';

create index newsletters_due_idx
  on newsletters (scheduled_at)
  where status in ('scheduled', 'sending');

-- ── הסרה מרשימת התפוצה ─────────────────────────────────────────────────────
-- חלה על ניוזלטרים בלבד. מסעות, כללים, תזכורות פגישה והודעות ידניות ממשיכים
-- כרגיל — אדם שביקש לא לקבל דיוור לא ביקש לנתק את הקשר האישי או התפעולי.
alter table contacts
  add column if not exists unsubscribed_at timestamptz;

comment on column contacts.unsubscribed_at is
  'מתי ביקש/ה לצאת מרשימת התפוצה. חוסם ניוזלטרים בלבד, לא מסעות/כללים/תזכורות.';

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table newsletters            enable row level security;
alter table newsletter_recipients  enable row level security;

create policy "team reads newsletters"  on newsletters           for select to authenticated using (true);
create policy "team writes newsletters" on newsletters           for all    to authenticated using (true) with check (true);
create policy "team reads recipients"   on newsletter_recipients for select to authenticated using (true);
create policy "team writes recipients"  on newsletter_recipients for all    to authenticated using (true) with check (true);
