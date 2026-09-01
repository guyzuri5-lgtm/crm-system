-- מצב האישור של תבניות אצל Meta.
--
-- עד עכשיו הרשומה המקומית החזיקה רק את *שם* התבנית ב-Meta, והנחנו שהיא קיימת
-- ומאושרת. זו הנחה שנשברת בשקט: תבנית נדחית, מושהית בגלל איכות ירודה, או
-- נמחקת בממשק של Meta — והרשומה כאן ממשיכה להצביע עליה. הגילוי מגיע רק
-- כששליחה נכשלת, כלומר על לקוח אמיתי, ובלי שאיש יראה.
--
-- העמודות כאן הן תמונת מצב מסונכרנת, לא מקור אמת. המקור הוא Meta, וכפתור
-- הסנכרון בעמוד התבניות הוא מה שמרענן אותן.

alter table message_templates
  add column if not exists meta_template_id text;

-- APPROVED | PENDING | REJECTED | PAUSED | DISABLED | MISSING
-- MISSING אינו סטטוס של Meta אלא שלנו: הרשומה מצביעה על שם שלא נמצא בסנכרון
-- האחרון. זו בדיוק התקלה השקטה שהמיגרציה הזו נועדה לחשוף.
alter table message_templates
  add column if not exists meta_status text;

alter table message_templates
  add column if not exists meta_category text;

-- ההסבר של Meta למה נדחתה. בלעדיו "נדחתה" הוא מבוי סתום.
alter table message_templates
  add column if not exists meta_rejected_reason text;

-- מתי נבדק מול Meta בפעם האחרונה. סטטוס בלי חותמת זמן אינו ניתן לאמון —
-- אי אפשר לדעת אם הוא מהיום או מלפני חודש.
alter table message_templates
  add column if not exists meta_synced_at timestamptz;

comment on column message_templates.meta_status is
  'תמונת מצב מ-Meta. MISSING = הרשומה מצביעה על שם שלא נמצא בסנכרון האחרון.';
