-- ── הגנות על המספר בגשר הלא רשמי ──────────────────────────────────────────
--
-- שלוש הגנות, שלושתן נגד הדבר שחוסם מספר בערוץ לא רשמי: דיווחי ספאם
-- ותבנית שליחה שנראית כמו בוט.
--
--   contacts.whatsapp_opted_out_at — מי שכתב "הסר". מאותו רגע לא יוצא אליו
--       שום וואטסאפ אוטומטי (מסעות, כללים, תזכורות). שליחה ידנית מהכרטיס
--       עדיין אפשרית: אדם שבוחר לכתוב יודע מה הוא עושה.
--
--   quiet_* — שעות שקטות: בלי וואטסאפ אוטומטי בלילה ובשבת. הודעה ממסע
--       שמגיעה לזמן כזה מחכה ויוצאת כשהוא נגמר. תזכורות אירוע לא כפופות —
--       המועד שלהן נקבע בכוונה.
--
--   bridge_alert_sent_at — מתי נשלח בפעם האחרונה מייל "הגשר מנותק", כדי
--       לא לשלוח אחד בכל ריצה של הקרון. מתאפס כשהגשר חוזר.

alter table contacts
  add column if not exists whatsapp_opted_out_at timestamptz;

alter table whatsapp_settings
  add column if not exists quiet_hours_enabled boolean not null default true,
  add column if not exists quiet_start_hour smallint not null default 21
    check (quiet_start_hour between 0 and 23),
  add column if not exists quiet_end_hour smallint not null default 8
    check (quiet_end_hour between 0 and 23),
  add column if not exists quiet_shabbat boolean not null default true,
  add column if not exists bridge_alert_sent_at timestamptz;
