-- ── המתזמן עובר מ-GitHub אל תוך המסד ────────────────────────────────────────
--
-- ── מה היה ──
-- `.github/workflows/cron.yml` קרא ל-/api/cron/check-rules כל 15 דקות.
-- הקובץ עצמו הזהיר מהיום הראשון ש"התזמון של GitHub הוא מאמץ סביר ולא
-- הבטחה", ובספטמבר 2026 האזהרה התממשה:
--
--     23.9 ..... 58 ריצות מתוך 96
--     24.9 ....... 6 ריצות מתוך 96
--     25.9 ....... 2 ריצות עד הצהריים
--
-- כל ריצה שכן יצאה לדרך הצליחה תוך 10 שניות. הבעיה מעולם לא הייתה בקוד
-- שלנו, ולכן גם לא ניתן היה לתקן אותה בקוד שלנו.
--
-- ── למה pg_cron ולא שירות חיצוני ──
-- cron-job.org ו-Upstash היו עובדים, אבל שניהם דורשים חשבון נוסף, סוד
-- שמועתק לשירות שלישי, ותלות בעוד ספק שאפשר לשכוח שהוא קיים. pg_cron רץ
-- בתוך המסד שכבר מחזיק את כל הנתונים, בתוכנית שכבר משולמת, ומתוזמן על ידי
-- פוסטגרס עצמו — לא על ידי תור משותף של CI.
--
-- ── למה 15 דקות ולא 5 ──
-- תקציב הריצה הוא 280 שניות (CRON_TIME_BUDGET_SECONDS). כל מרווח קצר מזה
-- מאפשר לשתי ריצות לחפוף, ושתי ריצות בו-זמנית יכולות שתיהן לשלוח לפני
-- שאחת מהן הספיקה לרשום — כלומר שליחה כפולה ללקוח. 15 דקות גדולות מ-280
-- שניות בביטחון, ולכן החפיפה **אינה אפשרית**, בלי שום מנעול. זו גם בדיוק
-- הרזולוציה שתזכורת "שעה לפני הפגישה" נבנתה לפיה.
--
-- ── הסוד ──
-- **הריפו הזה ציבורי.** CRON_SECRET לא יכול להופיע בקובץ הזה, ולכן הוא
-- נקרא מ-Supabase Vault. את השורה שמכניסה אותו לשם מריצים **פעם אחת
-- ובנפרד**, והיא לא נשמרת בגיט:
--
--     select vault.create_secret('<CRON_SECRET>', 'crm_cron_secret');
--
-- ── סדר ההרצה ──
--   1. Supabase → Database → Extensions → להדליק pg_cron ו-pg_net
--      (אפשר גם בשתי השורות שלמטה, אם הן עוברות).
--   2. את שורת ה-vault שלמעלה, עם הערך האמיתי.
--   3. את הקובץ הזה.
--   4. לוודא: select * from cron.job;

-- ── 1. התוספים ──
-- if not exists כדי שהרצה חוזרת לא תיפול. אם השורות האלה נדחות בהרשאות,
-- מדליקים את שני התוספים מהמסך הגרפי (Database → Extensions) ומדלגים עליהן.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. משימה ישנה, אם קיימת ──
-- delete ולא cron.unschedule: unschedule זורקת כשאין משימה בשם הזה, וזה
-- היה הופך הרצה חוזרת של הקובץ לכישלון.
delete from cron.job where jobname = 'crm-cron';

-- ── 3. המשימה ──
--
-- net.http_get אינה חוסמת: pg_net מכניס את הבקשה לתור ועובד רקע שולח אותה,
-- ולכן המשימה עצמה מסתיימת במילישניות ואינה מחזיקה חיבור למסד לאורך הריצה
-- של Vercel.
--
-- timeout_milliseconds נדיב בכוונה. ריצה רגילה נמשכת כ-10 שניות; ריצה עם
-- ניוזלטר גדול יכולה להגיע ל-280. אם pg_net יוותר לפניה, הבקשה כבר נשלחה
-- וה-endpoint ימשיך — אבל אין סיבה להכניס את עצמנו למצב הזה.
select cron.schedule(
  'crm-cron',
  '*/15 * * * *',
  $job$
    select net.http_get(
      url := 'https://crm-system-eight-omega.vercel.app/api/cron/check-rules',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret'
        )
      ),
      timeout_milliseconds := 120000
    );
  $job$
);

-- ── 4. מה שנשאר לבדוק אחרי ההרצה ──
--
-- המשימה קיימת:        select jobname, schedule, active from cron.job;
-- המשימה באמת רצה:     select status, start_time, return_message
--                        from cron.job_run_details
--                        where jobname = 'crm-cron'
--                        order by start_time desc limit 5;
-- הבקשה באמת יצאה:     select status_code, error_msg, created
--                        from net._http_response order by created desc limit 5;
--
-- **הבדיקה האמיתית היא cron_heartbeat.** cron.job_run_details אומר רק
-- שפוסטגרס שלח בקשה; רק הדופק אומר שה-endpoint באמת ענה ועבד:
--
--   select last_finished_at, last_error from cron_heartbeat;
