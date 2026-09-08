-- ── אישורי מסירה ────────────────────────────────────────────────────────────
--
-- עד כה המערכת ידעה רק "שלחנו". מה קרה אחרי זה — נמסר, נקרא, נפתח, נלחץ —
-- הגיע אלינו בפועל ונזרק: ה-webhook של וואטסאפ כבר קיבל delivered ו-read
-- ושמר רק את הכישלונות, ובמייל לא ביקשנו מעקב כלל.
--
-- ── למה טבלה נפרדת ולא עמודות על interactions ──
-- הדיווח והרישום הם מרוץ. sendMessageToContact שולחת, מקבלת מזהה, ורק אז
-- כותבת את שורת היומן — ומטא מספיקה לדווח "נמסר" בתוך החלון הזה. זה כבר קרה
-- בפועל עם דיווח כישלון (6.9.2026), ושם זה נפתר בלולאת ניסיונות חוזרים
-- שמחזיקה את מטא בהמתנה. כאן אין צורך: המפתח הוא מזהה ההודעה עצמו, ולכן
-- אפשר לרשום את הדיווח **לפני** שקיימת שורת היומן שהוא מדבר עליה. אין מרוץ
-- ואין השהיה.
--
-- ── מפתח אחד לשני ערוצים ──
-- wamid של מטא ו-MessageID של Postmark הם מחרוזות זרות זו לזו ולעולם לא
-- יתנגשו. טבלה אחת פירושה שאילתה אחת לכל שאלה על ביצועים, במקום איחוד של
-- שתי טבלאות שנבדלות רק בשם העמודות.

create table if not exists message_receipts (
  -- wamid (וואטסאפ) או MessageID (Postmark). זה גם external_id של שורת
  -- היומן, וגם message_id של שורת נמען הניוזלטר.
  external_id text primary key,
  channel message_channel not null,

  -- הגיע למכשיר / לתיבה. וואטסאפ מדווח על זה תמיד; Postmark רק כשמוגדר
  -- webhook של Delivery.
  delivered_at timestamptz,

  -- וואטסאפ: הלקוח פתח את הצ'אט וראה. מייל: נטענה תמונת המעקב.
  --
  -- שני הדברים אינם שווי ערך, ובמייל המספר הזה אינו אמת מדויקת: אפל פותחת
  -- אוטומטית כל מייל של מי שמשתמש ב-Mail באייפון, ומי שחוסם תמונות לא נספר
  -- כלל. הוא שווה כמגמה בין דיוורים, לא כמספר מוחלט. הקליק הוא המדד הכן.
  opened_at timestamptz,

  -- מייל בלבד — לחיצה על קישור בגוף ההודעה.
  clicked_at timestamptz,

  -- לא נמסר. וואטסאפ מדווח failed; Postmark מדווח Bounce או SpamComplaint.
  failed_at timestamptz,
  error text,

  -- כמה פעמים, ולא רק האם. פתיחה חוזרת של אותו מייל היא סימן אמיתי לעניין.
  open_count  int not null default 0,
  click_count int not null default 0,

  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── אינדקסים ────────────────────────────────────────────────────────────────
-- כל שאילתות הביצועים מצטרפות לטבלה הזו לפי external_id (המפתח הראשי), אבל
-- הן גם מסננות לפי ערוץ ולפי חלון זמן — "מה קרה בדיוור של אתמול".
create index if not exists message_receipts_channel_seen_idx
  on message_receipts (channel, first_seen_at desc);

-- ── message_id על נמעני הניוזלטר ────────────────────────────────────────────
--
-- שורת היומן (interactions) תקבל גם היא את המזהה, אבל היא לא יודעת **לאיזה
-- ניוזלטר** היא שייכת — התוכן שנרשם בה הוא הכותרת, וכותרת אינה מפתח. בלי
-- העמודה הזו אי אפשר לומר "בדיוור של אתמול נפתחו 34%".
alter table newsletter_recipients
  add column if not exists message_id text;

comment on column newsletter_recipients.message_id is
  'MessageID של Postmark. מתחבר ל-message_receipts.external_id כדי לקבל פתיחות וקליקים לדיוור הזה.';

create index if not exists newsletter_recipients_message_id_idx
  on newsletter_recipients (message_id)
  where message_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- אותה מדיניות כמו בשאר הטבלאות: האפליקציה ניגשת עם service role ועוקפת אותן
-- ממילא, והן קו הגנה שני למקרה שמפתח anon יגיע ללקוח.
alter table message_receipts enable row level security;

drop policy if exists "team reads receipts"  on message_receipts;
drop policy if exists "team writes receipts" on message_receipts;

create policy "team reads receipts"  on message_receipts for select to authenticated using (true);
create policy "team writes receipts" on message_receipts for all    to authenticated using (true) with check (true);
