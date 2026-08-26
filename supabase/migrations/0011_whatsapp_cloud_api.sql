-- מעבר מ-Green API ל-WhatsApp Cloud API הרשמי של Meta
--
-- הרצה: Supabase SQL editor, אחרי 0010.
--
-- למה החלפנו שוב: Green API מתחבר לחשבון WhatsApp אמיתי דרך פרוטוקול
-- WhatsApp Web, ולכן הוא דורש מכשיר פיזי שהחשבון חי עליו ונשאר מחובר. המספר
-- העסקי כאן הוא מספר וירטואלי (Zadarma) בלי מכשיר, וזה הופך את המסלול הזה
-- לבלתי אפשרי. Cloud API עובד ישירות מול Meta, בלי שום מכשיר — והוא גם
-- הערוץ המאושר, כלומר המספר אינו חשוף לחסימה על שליחה יזומה.
--
-- מה שחוזר בתמורה: חלון 24 השעות ותבניות שדורשות אישור של Meta. שניהם חוקים
-- של Meta ולא של מתווך כלשהו — ולכן הם לא מביאים איתם את הסיבוך של ManyChat
-- (flow_ns, שדות מותאמים, פלואו ידני לכל תבנית). שליחת תבנית כאן היא קריאת
-- HTTP אחת עם שם התבנית והפרמטרים.

-- ── contacts: wa_id במקום chat id ───────────────────────────────────────
-- Green API מיען לפי "972501234567@c.us". Meta מיענת לפי wa_id, שהוא המספר
-- בפורמט בינלאומי בלי + ובלי סיומת. השם הישן היה מונח של Green API, ולכן
-- העמודה משנה שם ולא רק תוכן.
alter table contacts rename column whatsapp_chat_id to whatsapp_id;

-- הסרת הסיומת מערכים שכבר נשמרו, כדי שאנשי קשר שנקלטו דרך Green API
-- ימשיכו להיות מזוהים ולא ייווצרו מחדש ככפילות.
update contacts
set whatsapp_id = split_part(whatsapp_id, '@', 1)
where whatsapp_id like '%@%';

-- הודעות מקבוצה נשמרו עם מזהה קבוצה, שאין לו משמעות מול Meta — Cloud API
-- אינו עובד עם קבוצות בכלל. ריקון הערך משאיר את איש הקשר ואת ההיסטוריה שלו,
-- ורק מנתק מזהה שלא ניתן לשלוח אליו.
update contacts
set whatsapp_id = null
where whatsapp_id !~ '^[0-9]{8,16}$';

-- ── message_templates: תבנית מאושרת של Meta ─────────────────────────────
-- שם התבנית כפי שאושרה, ולא מזהה אטום: Meta ממענת תבנית לפי שם + שפה, וזה
-- בדיוק מה שרואים בממשק שלה. ההבדל מ-manychat_template_id שהיה כאן פעם הוא
-- שאין שום ישות ביניים לבנות — מה שרשום כאן הוא מה שמופיע ב-Meta.
alter table message_templates
  add column if not exists meta_template_name text;

-- קוד השפה שאיתו אושרה התבנית ("he", "en_US"). Meta דורשת התאמה מדויקת;
-- תבנית שאושרה ב-he ונשלחת עם en_US פשוט נדחית.
alter table message_templates
  add column if not exists meta_language_code text not null default 'he';

/*
 * מה ממלא את {{1}}, {{2}} ... בגוף התבנית המאושרת, לפי הסדר.
 *
 * כל איבר הוא ביטוי מציין־מקום של המערכת ("{{full_name}}"), שעובר את אותו
 * renderTemplate שכבר משמש את גוף ההודעה. כך יש מודל מנטלי אחד בלבד למי
 * שכותב תבנית, ולא שתי שפות מציינים שונות באותו מסך.
 *
 * text[] ולא jsonb: זו רשימה מסודרת של מחרוזות, ו-jsonb היה רק מוסיף
 * צורך בפרסור בלי להוסיף שום ביטוי.
 */
alter table message_templates
  add column if not exists meta_variables text[] not null default '{}';

-- ── whatsapp_settings: מבלם חסימה לבלם עלות ─────────────────────────────
-- ההשהיות ב-0010 נועדו למנוע חסימה של מספר על ידי WhatsApp — סיכון שקיים
-- ב-Green API ולא קיים כאן, כי Cloud API הוא הערוץ המאושר של Meta. אין להן
-- יותר תפקיד, והן יורדות.
--
-- daily_limit דווקא נשאר, ומשמעותו התהפכה: הוא כבר לא מגן על המספר אלא על
-- הכיס. ב-Cloud API כל תבנית שנמסרת עולה כסף, ולולאה שהשתבשה היא חשבונית.
alter table whatsapp_settings drop column if exists min_delay_seconds;
alter table whatsapp_settings drop column if exists max_delay_seconds;

comment on column whatsapp_settings.daily_limit is
  'תקרת תבניות יומית. בלם עלות: כל תבנית שנמסרת מחויבת על ידי Meta.';

-- ── interactions.external_id ────────────────────────────────────────────
-- נשאר בדיוק כפי שהוא, רק שהערך שנשמר בו הוא עכשיו wamid של Meta במקום
-- idMessage של Green API. אותו תפקיד: דה-דופליקציה של webhook שנשלח שוב.
comment on column interactions.external_id is
  'wamid של Meta, לדה-דופליקציה של webhooks. ריק לשורות פנימיות.';
