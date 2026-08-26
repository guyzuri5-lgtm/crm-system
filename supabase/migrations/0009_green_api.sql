-- מעבר מ-ManyChat ל-Green API
--
-- הרצה: Supabase SQL editor, אחרי 0008.
--
-- מה השתנה מבחינת מוצר, ולמה זה מפשט כל כך הרבה:
-- ManyChat דיבר מול WhatsApp Business API הרשמי של Meta, ומשם הגיעו שלוש
-- מגבלות שחלחלו לכל הסכימה — חלון 24 השעות, תבניות שחייבות אישור של Meta,
-- ו"מזהה מנוי" שנוצר רק אחרי שההודעה הראשונה כבר הגיעה. Green API מתחבר
-- לחשבון WhatsApp אמיתי דרך פרוטוקול WhatsApp Web: אין חלון, אין תבניות
-- מאושרות, והנמען מזוהה לפי מספר הטלפון שלו בלבד. שלוש העמודות שנשענו על
-- המגבלות האלה יורדות כאן.
--
-- המיגרציה שומרת על ההיסטוריה: כל שורת interactions קיימת עוברת מיפוי
-- לערך החדש במקום להימחק.

-- ── interaction_type: החלפת הטיפוס, לא תיקון שלו ────────────────────────
-- פוסטגרס לא מאפשר להסיר ערך מ-enum. הדרך היחידה להיפטר מ-manychat_in/out
-- היא ליצור טיפוס חדש, להסב אליו את העמודה תוך כדי מיפוי הערכים, ולמחוק את
-- הישן. שינוי שם הטיפוס הישן קודם הוא מה שמאפשר לטיפוס החדש לקבל את השם
-- המקורי, כך ששום קוד אחר לא צריך לדעת שמשהו קרה.
--
-- ‎if exists‎ על השינוי שם: אם המיגרציה נכשלה באמצע והורצה שוב, הטיפוס הישן
-- כבר עשוי להיות בשם ‎_old‎.
do $$
begin
  if exists (select 1 from pg_type where typname = 'interaction_type') then
    alter type interaction_type rename to interaction_type_old;
  end if;
end $$;

create type interaction_type as enum (
  'whatsapp_in',
  'whatsapp_out',
  'email_out',
  'manual_note',
  'quiz_submitted',
  'booking_created',
  'booking_cancelled'
);

alter table interactions
  alter column type type interaction_type
  using (
    case type::text
      when 'manychat_in' then 'whatsapp_in'
      when 'manychat_out' then 'whatsapp_out'
      else type::text
    end
  )::interaction_type;

drop type if exists interaction_type_old;

-- ── contacts: chat id במקום subscriber id ───────────────────────────────
-- ההבדל אינו רק בשם. manychat_subscriber_id היה מזהה אטום ש-ManyChat ייצר,
-- ולכן אי אפשר היה לשלוח לאיש קשר לפני שהוא כתב לנו פעם אחת. chatId של
-- Green API נגזר ישירות מהטלפון (‎972501234567@c.us‎) — כלומר אפשר לשלוח
-- לכל מי שיש לו מספר, גם אם מעולם לא כתב.
--
-- העמודה עדיין נשמרת ולא מחושבת בכל פעם מחדש: הצורה שוואטסאפ מחזיר היא
-- מקור האמת (יש מספרים שבהם ה-chatId אינו הטלפון), ועדיף לשמור את מה
-- שהתקבל בפועל מאשר לנחש אותו כל פעם.
alter table contacts drop column if exists manychat_subscriber_id;
alter table contacts add column if not exists whatsapp_chat_id text unique;

-- 'ManyChat' כמקור הליד הוא שם של כלי שכבר לא בשימוש.
update contacts set source = 'WhatsApp' where source = 'ManyChat';

-- ── message_templates: אין יותר תבניות מאושרות ──────────────────────────
-- העמודה החזיקה flow_ns של פלואו ב-ManyChat שהצעד הראשון שלו היה תבנית
-- מאושרת של Meta — מנגנון שהיה נחוץ *רק* כדי לשלוח מחוץ לחלון 24 השעות.
-- ב-Green API כל תבנית היא טקסט רגיל שנשלח כמו כל הודעה אחרת.
alter table message_templates drop column if exists manychat_template_id;

-- ── interactions.external_id — דה-דופליקציה של webhooks ─────────────────
-- Green API שולח כל webhook עד שהשרת עונה 200, ומנסה שוב אם לא. בלי מזהה
-- ייחודי, ניסיון חוזר על הודעה שכבר נרשמה היה מייצר שורה כפולה ביומן איש
-- הקשר. idMessage של וואטסאפ הוא בדיוק המזהה הזה.
--
-- nullable: שורות שנוצרות בתוך המערכת (הערה ידנית, פגישה שנקבעה, מייל יוצא)
-- אינן מגיעות מ-webhook ואין להן מזהה חיצוני. אינדקס יחיד *חלקי* הוא מה
-- שמאפשר את זה — unique רגיל היה מתיר NULL אחד בלבד בחלק מהמימושים, ופה
-- רוב השורות הן NULL.
alter table interactions add column if not exists external_id text;

create unique index if not exists interactions_external_id_idx
  on interactions (external_id)
  where external_id is not null;
