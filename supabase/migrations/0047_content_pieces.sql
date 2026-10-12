-- ── פיסות תוכן: מספר סידורי אחד מהמסמך בדרייב ועד הביצועים באינסטגרם ──────
--
-- כל פיסה (מסמך "גרסה בשפה שלי" בדרייב) מקבלת מספר ברגע שהיא נכנסת לאחת
-- מתיקיות הפרומפטר. אותו מספר עובר לתיקיית הסרטון ("13- כותרת"), לפריט בגאנט
-- (data.intake.sourceKey) ולרילס שעלה — וכך כל פיסה מחוברת לנתונים שלה.
--
-- מונה אחד לשתי תיקיות הפרומפטר (יוטיוב ואינסטגרם): המספר הוא המפתח הראשי,
-- ולכן כפילות לא יכולה להיווצר גם אם שתי ריצות מקצות בו-זמנית.
-- 1–12 מוזנים כאן בדיעבד (הסרטונים שכבר צולמו). המונה ממשיך מ-13.

create table if not exists content_pieces (
  piece_no      int primary key,
  title         text not null,
  drive_doc_id  text unique,
  drive_folder  text,                 -- youtube | instagram
  script        text,                 -- הטקסט של "גרסה בשפה שלי"
  doc_modified  text,                 -- modifiedTime של המסמך בפעם האחרונה שנקרא
  status        text not null default 'prompter', -- prompter|filmed|in_gantt|published
  video_folder  text,                 -- שם תיקיית הסרטון, "13- כותרת"
  match_score   real,
  item_id       text,                 -- content_items.id
  ig_media_id   text,
  ig_permalink  text,
  metrics       jsonb,
  metrics_at    timestamptz,
  prompter_at   timestamptz not null default now(),
  filmed_at     timestamptz,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists content_pieces_item_idx on content_pieces (item_id);
create index if not exists content_pieces_unfilmed_idx on content_pieces (piece_no) where video_folder is null;

create sequence if not exists content_piece_no_seq;
alter table content_pieces alter column piece_no set default nextval('content_piece_no_seq');
alter sequence content_piece_no_seq owned by content_pieces.piece_no;

alter table content_pieces enable row level security;

-- ── בדיעבד: 12 הסרטונים שכבר צולמו ──
-- 8 חסר: אין תיקייה בשם "8-" ואין לו מסמך מזוהה. אם יימצא, מוסיפים שורה ידנית.
insert into content_pieces (piece_no, title, drive_doc_id, drive_folder, status, video_folder, filmed_at) values
  (1,  'מגן דוד כסמל לאחדות',               '1nj9uoUqoTl79ytWgPAAzoW7i-N61E1F4XAIBwMRWUH8', 'instagram', 'filmed', '1- מגן דוד כסמל לאחדות', now()),
  (2,  'ההילה שלנו כמו המגן של כדור הארץ',  '13lNR0WfCxBfvgjQBVZ2ckHE9PpZMMlOwrt6HEDAc8EE', 'instagram', 'filmed', '2- ההילה שלנו כמו המגן של כדור הארץ', now()),
  (3,  'למה מצמידים ידיים בתפילה',          '1cXG-RXI-DAXJ54CW_Wwa0KyHQ5KbYPbJFy6LOoJT9PY', 'instagram', 'filmed', '3- למה מצמידים ידיים בתפילה', now()),
  (4,  'למה כל תרבות עתיקה סגדה לשמש',      '1Mrrqlf3B2QvEi5TVa-TeSQaknu-fQ_G4VI9BI9yRVtg', 'instagram', 'filmed', '4- למה כל תרבות עתיקה סגדה לשמש', now()),
  (5,  'למה כל כך קשה לשבור הרגל רע',       '19cnvn1RCF1Vb6akFNbK7VUQQLYGxTC7hBTa09SZNyCo', 'instagram', 'filmed', '5- למה כל כך קשה לשבור הרגל רע', now()),
  (6,  'הכוח הייחודי שנולדת איתו',          '1uFBkqH3xKKp9aBRI3zgyFt1umDioJWI4rXnFp7rHbc8', 'instagram', 'filmed', '6- הכוח הייחודי שנולדת איתו', now()),
  (7,  'ההילה סביב ראשי הקדושים',           '1Mxd-VEqycwH5MUsnO7YdHaGUdU1Y_d1yTeWPGBhuZoQ', 'instagram', 'filmed', '7- ההילה סביב ראשי הקדושים', now()),
  (9,  'יצירתיות היא אנרגיה ולא כישרון',    '1LvbuMAMJbECfL-76KSCvTbEfLTIblCB3JoNOp7-NZno', 'instagram', 'filmed', '9- יצירתיות היא אנרגיה ולא כישרון', now()),
  (10, 'ההילה שלנו כמו מסננת',              '1xbSs2lJUHDSFn5jiDI5Hw911lQIyMlqgK4aO6odOw1c', 'instagram', 'filmed', '10- ההילה שלנו כמו מסננת', now()),
  (11, 'איך לראות את ההילה שלכם',           '1k7bkM-GUTRROT_uP0dafy01JuNh-PkHYESubrvl4t0o', 'instagram', 'filmed', '11- איך לראות את ההילה שלכם', now()),
  (12, 'האם רק התודעה שלך באמת קיימת',      '13YnBDp61U7TzIiMCGBBf3iFTMKqoXrj2wDJvIl1gozw', 'instagram', 'filmed', '12- האם רק התודעה שלך באמת קיימת', now())
on conflict (piece_no) do nothing;

select setval('content_piece_no_seq', greatest(12, (select coalesce(max(piece_no), 0) from content_pieces)));
