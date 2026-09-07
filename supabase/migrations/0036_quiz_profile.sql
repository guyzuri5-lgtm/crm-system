-- שאלות הפרופיל של השאלון: מין, טווח גיל, שלושה מדדי 1–10 ואזורי כאב.
-- הן אינן מנוקדות ואינן משפיעות על תוצאת השאלון; הן נאספות כדי לתת הקשר
-- לשיחה עם הליד. המפרט: "שאלון צ׳אקרות/PROFILE-CONTRACT.md".
--
-- jsonb ולא עמודות נפרדות: רשימת השאלות תשתנה, ועמודה אחת חוסכת מיגרציה
-- בכל שינוי נוסח. ברירת מחדל '{}' כדי שרשומות קיימות יישארו תקינות.
alter table quiz_submissions
  add column if not exists profile jsonb not null default '{}'::jsonb;

-- הפילוח השימושי ביותר בפועל הוא לפי גיל ומין. בלי האינדקסים האלה כל
-- שאילתת פילוח סורקת את הטבלה כולה.
create index if not exists quiz_submissions_profile_age_idx
  on quiz_submissions ((profile->>'age'));

create index if not exists quiz_submissions_profile_gender_idx
  on quiz_submissions ((profile->>'gender'));
