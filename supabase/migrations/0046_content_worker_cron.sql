-- ── עובד הרקע של גאנט התוכן: כל דקה ──────────────────────────────────────────
--
-- נפרד מ-crm-cron (0043) בכוונה. ההוא רץ כל 15 דקות כי הוא שולח הודעות
-- ללקוחות ותקציב הריצה שלו 280 שניות. העובד הזה צריך דקה אחת: אוטומציה לפוסט
-- מתוזמן נוצרת 3 דקות לפני הפרסום ומוצמדת לפוסט ברגע שהוא עולה, ואסור שהיא
-- תישאר ברמת החשבון יותר מכמה דקות. הריצה שלו קצרה (קריאות GET ספורות), ושתי
-- ריצות חופפות לא יכולות לשלוח פעמיים: כל יצירה נרשמת במסד לפני שממשיכים,
-- והעובד תופס מנעול קצר (content_try_lease ב-0045).
--
-- משתמש באותו סוד מה-vault כמו 0043 (crm_cron_secret) — אין סוד חדש.
-- להריץ אחרי 0045, ואחרי שהקוד של /api/cron/content-worker נפרס.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('content-worker');
exception
  when others then null;
end $$;

select cron.schedule(
  'content-worker',
  '* * * * *',
  $job$
    select net.http_get(
      url := 'https://crm-system-eight-omega.vercel.app/api/cron/content-worker',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'crm_cron_secret'
        )
      ),
      timeout_milliseconds := 90000
    );
  $job$
);
