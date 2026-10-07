-- ── גאנט תוכן: תכנון, תזמון לרשתות דרך Zernio, ובנק אוטומציות תגובה ──────────
--
-- כל הטבלאות כאן חדשות ומתחילות ב-content_. המיגרציה לא נוגעת באף טבלה קיימת.
-- הגישה אליהן היא דרך service role בלבד (src/lib/content/*), כמו בשאר המערכת.
-- RLS מופעל ובלי policies: מפתח anon שייחשף לא יקרא ולא יכתוב כאן.
--
-- מחיקה של פריט בלוח היא רכה (deleted_at). הלוח הזה כבר אבד פעם אחת בניקוי
-- דפדפן, ושום מסלול כאן לא אמור להיות הפעם השנייה.

-- ── הלוח: ההגדרות (סוגים, סטטוסים, ימי העלאה...) בשורה אחת ──
create table if not exists content_board (
  id boolean primary key default true check (id),
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into content_board (id) values (true) on conflict (id) do nothing;

-- ── פריטי התוכן. השדות של הגאנט עצמו ב-data, כדי ששום שדה שגרסה של הגאנט
-- הוסיפה לא ייפול בדרך ──
create table if not exists content_items (
  id text primary key,
  data jsonb not null,
  date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists content_items_date_idx on content_items (date) where deleted_at is null;

-- ── קבצים שהועלו לפריט ──
-- הקובץ עצמו לא נשמר כאן ולא ב-Supabase Storage: הדפדפן מעלה אותו ישירות
-- מהמחשב לאחסון של Zernio (POST /media/presign → PUT), ופה נשמרת רק הכתובת.
-- Zernio שומר העלאה כזו 7 ימים, ומעתיק אותה לאחסון קבוע ברגע שפוסט מפנה
-- אליה — ולכן uploaded_at: קובץ ישן מ-6 ימים שעוד לא בפוסט מתבקש מחדש.
create table if not exists content_media (
  id text primary key,
  item_id text not null,
  filename text,
  public_url text not null,
  zernio_key text,
  content_type text,
  size bigint,
  sort int not null default 0,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'uploading',  -- uploading|ready
  uploaded_at timestamptz,
  used_in_post_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists content_media_item_idx on content_media (item_id) where deleted_at is null;

-- ── פוסט אחד ב-Zernio לכל פריט ──
create table if not exists content_publications (
  item_id text primary key,
  zernio_post_id text,
  status text not null default 'draft',   -- draft|scheduled|publishing|published|partial|failed|cancelled|unknown
  scheduled_for text,                     -- שעון מקומי YYYY-MM-DDTHH:MM
  timezone text,
  last_synced_at timestamptz,
  last_error text,
  sent_payload jsonb,
  raw jsonb,
  updated_at timestamptz not null default now()
);

-- ── מצב לכל רשת בפוסט ──
create table if not exists content_targets (
  item_id text not null,
  platform text not null,
  account_id text,
  caption_override text,
  options jsonb,
  platform_post_id text,
  permalink text,
  status text not null default 'draft',
  error text,
  updated_at timestamptz not null default now(),
  primary key (item_id, platform)
);

-- ── בנק האוטומציות: אוטומציה אחת, הרבה פוסטים ──
create table if not exists content_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'אוטומציה חדשה',
  trigger_mode text not null default 'keyword' check (trigger_mode in ('keyword', 'any')),
  keyword text,
  match_mode text not null default 'word' check (match_mode in ('exact', 'word', 'contains')),
  gate_enabled boolean not null default false,
  verify_text text,          -- למי שלא ידוע אם עוקב: "לחץ ואשלח"
  verify_button text,
  gate_text text,            -- למי שלא עוקב: בקשת העוקב
  dm1_text text,
  button_title text,
  email_enabled boolean not null default false,
  email_ask_text text,
  email_invalid_text text,
  email_thanks_text text,
  link_enabled boolean not null default true,
  link text,
  link_text text,
  link_card_title text,
  link_button_title text,
  closing_text text,
  comment_reply text,
  zernio_workflow_id text,   -- workflow אחד לאוטומציה, משותף לכל הפוסטים
  deployed_hash text,        -- טביעת התוכן שנשלח ל-Zernio, כדי לזהות שינויים שלא נשלחו
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  last_error text,
  stats jsonb,
  stats_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ── קישור אוטומציה לפוסט: אוטומציית תגובה אחת ב-Zernio לכל קישור ──
create table if not exists content_automation_links (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references content_automations (id),
  item_id text not null,
  zernio_automation_id text,
  status text not null default 'armed',  -- armed|live|paused|error|unlinked
  scope text,                             -- account|post
  approved jsonb,                         -- הגוף שאושר במסך האישור, לעובד הרקע (בלי המפתח)
  last_error text,
  armed_at timestamptz,
  scoped_at timestamptz,
  stats jsonb,
  stats_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unlinked_at timestamptz
);
-- פוסט מקבל לכל היותר אוטומציה אחת (מגבלה של אינסטגרם/Zernio)
create unique index if not exists content_links_one_per_post
  on content_automation_links (item_id) where unlinked_at is null;
create index if not exists content_links_automation_idx on content_automation_links (automation_id);

-- ── מיילים שנאספו בצ'אט ──
create table if not exists content_emails (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references content_automations (id),
  execution_id text not null unique,
  email text not null,
  conversation_id text,
  contact_id uuid references contacts (id) on delete set null,
  collected_at timestamptz not null default now(),
  raw jsonb
);
create index if not exists content_emails_automation_idx on content_emails (automation_id);

-- ── יומן: כל קריאה שמשנה משהו ב-Zernio (בלי המפתח) ──
create table if not exists content_audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  action text,
  item_id text,
  method text,
  path text,
  request text,
  status_code int,
  ok boolean,
  response text
);

-- ── מסך אישור שמחכה ל"אשר" ──
create table if not exists content_pending_actions (
  id text primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  item_id text,
  plan jsonb not null,
  status text not null default 'pending',
  executed_at timestamptz,
  result jsonb
);

-- ── הגדרות, התראות, מטמונים ──
create table if not exists content_meta (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- ── נתוני הרילז למסך הניתוח (הועברו מה-Supabase של הגאנט הישן) ──
create table if not exists content_ig_imports (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table content_board enable row level security;
alter table content_items enable row level security;
alter table content_media enable row level security;
alter table content_publications enable row level security;
alter table content_targets enable row level security;
alter table content_automations enable row level security;
alter table content_automation_links enable row level security;
alter table content_emails enable row level security;
alter table content_audit_log enable row level security;
alter table content_pending_actions enable row level security;
alter table content_meta enable row level security;
alter table content_ig_imports enable row level security;

-- ── מנעול קצר (lease) — שתי ריצות של העובד לא חופפות ──
-- מחזיר true רק למי שתפס. משתחרר לבד אחרי p_seconds, כך שריצה שנקטעה לא
-- נועלת את הבאות לנצח.
create or replace function content_try_lease(p_key text, p_seconds int)
returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    insert into content_meta (key, value, updated_at)
    values (p_key, jsonb_build_object('until', extract(epoch from now()) + p_seconds), now())
    on conflict (key) do update
      set value = excluded.value, updated_at = now()
      where coalesce((content_meta.value->>'until')::float, 0) < extract(epoch from now())
    returning 1
  )
  select exists (select 1 from taken);
$$;
revoke all on function content_try_lease(text, int) from public, anon, authenticated;
