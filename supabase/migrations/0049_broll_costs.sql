-- ── עלות הבירולים לכל סרטון ──────────────────────────────────────────────
--
-- שורה לכל סרטון שהסקיל talking-head-to-ae ערך באפטר. הסקיל שולח אותה בסוף
-- העריכה (scripts/report_cost.py), ושוב כשהריצה האוטומטית מסתיימת, כדי שגם
-- התורות האחרונות של קלוד ייכנסו. לכן המפתח הוא תיקיית הסרטון: שליחה חוזרת
-- מעדכנת את אותה שורה ולא מוסיפה עוד אחת.
--
-- שתי עלויות נפרדות, כי הן משולמות במקומות שונים:
--  - ai_usd: יצירת תמונות וסרטונים ב-fal, לפי ae_edit/fal_usage.json.
--  - claude_usd: הטוקנים של שיחת העריכה, לפי מחירון ה-API (אומדן; במנוי
--    אין חשבונית לכל שיחה, אבל זה מה שהעבודה הייתה עולה).

create table if not exists content_broll_costs (
  video_folder   text primary key,          -- "13- כותרת", או שם התיקייה אם אין מספר
  piece_no       int,                        -- content_pieces.piece_no כשידוע
  title          text not null,
  ai_brolls      int not null default 0,     -- בירולי AI שנכנסו לעריכה הסופית
  ai_videos      int not null default 0,     -- סרטונים שנוצרו (כולל ניסיונות חוזרים)
  ai_images      int not null default 0,     -- תמונות שנוצרו
  ai_seconds     numeric not null default 0, -- שניות וידאו שנוצרו
  ai_usd         numeric not null default 0,
  claude_usd     numeric,                    -- null = לא נמצא תיעוד של השיחה
  claude_tokens  bigint,
  details        jsonb,                      -- פירוט לפי מודל, ומזהי השיחות
  edited_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists content_broll_costs_edited_idx on content_broll_costs (edited_at desc);

alter table content_broll_costs enable row level security;
