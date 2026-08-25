-- מייל הדוח המלא אחרי מילוי טופס הלידים בשאלון
--
-- הרצה: Supabase SQL editor, אחרי 0003_statuses.sql.
--
-- העמודה היחידה שנוספת היא חותמת "נשלח". בלעדיה כל POST חוזר עם אותו
-- sessionId (רענון דף, לחיצה על "קביעת פגישה" אחרי הטופס, ניסיון חוזר של
-- הדפדפן במצב no-cors) היה גורם למייל נוסף לאותו אדם.

alter table quiz_submissions
  add column if not exists results_email_sent_at timestamptz;

comment on column quiz_submissions.results_email_sent_at is
  'מתי נשלח מייל הדוח המלא. null = טרם נשלח. משמש כמנעול חד-פעמיות.';

-- שליפה מהירה של מילויים שהשאירו פרטים אבל המייל אליהם נכשל
create index if not exists quiz_submissions_email_pending_idx
  on quiz_submissions (submitted_at desc)
  where results_email_sent_at is null and contact_id is not null;
