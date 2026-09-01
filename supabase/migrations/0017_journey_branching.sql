-- ── הסתעפויות במסע ─────────────────────────────────────────────────────────
--
-- 0016 נתנה לכל שלב את stop_if_replied — "אם ענה, עצור". זה כיסה את המקרה
-- השכיח אבל ערבב שתי שאלות שונות תחת דגל אחד: מתי המסע *נגמר*, ומתי שלב
-- מסוים *רץ*. הערבוב הזה חוסם בדיוק את מה שביקשנו עכשיו — מסלול שונה למי
-- שענה לעומת מי שלא.
--
-- ההפרדה:
--   journeys.stop_on_reply     — האם תגובה מסיימת את המסע כולו
--   journey_steps.condition    — האם השלב הזה רץ, ולמי
--
-- כשה-stop כבוי, condition הופך למנגנון הסתעפות אמיתי: שלב אחד עם
-- if_replied ואחריו שלב עם if_not_replied הם שני מסלולים על אותו טור.
--
-- הטבלאות עדיין ריקות (0016 נוצרה היום), ולכן אפשר לתקן את המבנה במקום
-- לערום עליו עמודה נוספת ולחיות עם השתיים.

alter table journeys
  add column if not exists stop_on_reply boolean not null default true;

comment on column journeys.stop_on_reply is
  'תגובה של הלקוח מסיימת את המסע כולו. כבו כדי לבנות מסלולים נפרדים לפי condition.';

alter table journey_steps
  drop column if exists stop_if_replied;

-- always         — תמיד רץ
-- if_replied     — רק אם הלקוח ענה מאז שנכנס למסע
-- if_not_replied — רק אם לא ענה
alter table journey_steps
  add column if not exists condition text not null default 'always';

alter table journey_steps
  drop constraint if exists journey_steps_condition_check;

alter table journey_steps
  add constraint journey_steps_condition_check
  check (condition in ('always', 'if_replied', 'if_not_replied'));

comment on column journey_steps.condition is
  'האם השלב רץ. שלב שתנאיו אינם מתקיימים מדולג מיד, בלי להמתין ובלי לשלוח.';
