-- בנק האוטומציות גם בפייסבוק.
-- קישור (אוטומציה ↔ פוסט) הופך לקישור לכל רשת: לאותו פוסט יכולה להיות אוטומציית
-- תגובה אחת באינסטגרם ואחת בפייסבוק, ושתיהן מאותה אוטומציה בבנק.
-- הקישורים הקיימים כולם אינסטגרם, ולכן ברירת המחדל.

alter table content_automation_links
  add column if not exists platform text not null default 'instagram'
  check (platform in ('instagram', 'facebook'));

drop index if exists content_links_one_per_post;
-- לכל פוסט לכל היותר אוטומציה אחת בכל רשת (מגבלה של Meta/Zernio)
create unique index if not exists content_links_one_per_post_platform
  on content_automation_links (item_id, platform) where unlinked_at is null;

-- workflow הכפתור רץ על חשבון אחד, ולכן לדף בפייסבוק יש workflow משלו
alter table content_automations add column if not exists fb_workflow_id text;
