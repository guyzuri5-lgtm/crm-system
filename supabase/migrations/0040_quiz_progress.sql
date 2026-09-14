-- מעקב נשירה בשאלון הצ'אקרות.
--
-- למה טבלה נפרדת מ-quiz_submissions: שורה שם נוצרת רק כשמישהו מסיים את
-- השאלון. כל מי שנטש באמצע — ושם נמצאת הנשירה האמיתית — לא הופיע בשום
-- מקום. הטבלה הזאת נוצרת לכל מי שנחת על הדף, כולל מי שלא לחץ "בואו נתחיל".
--
-- אין כאן שום פרט מזהה: רק ה-sessionId האקראי שהשאלון מייצר ממילא.
-- זה מונה, לא מעקב.
create table if not exists quiz_progress (
  session_id     text primary key,
  -- 0 = נחת על מסך הפתיחה ולא התחיל. 1..total = הצעד הרחוק ביותר שהגיע אליו.
  reached_step   integer not null default 0,
  total_steps    integer not null default 0,
  reached_label  text,
  completed      boolean not null default false,
  source         text,
  utm            jsonb   not null default '{}'::jsonb,
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- הדוח נשען על שתי השאילתות האלה: התפלגות לפי צעד, וחיתוך לפי תאריך.
create index if not exists quiz_progress_reached_step_idx
  on quiz_progress (reached_step);

create index if not exists quiz_progress_first_seen_idx
  on quiz_progress (first_seen_at desc);
