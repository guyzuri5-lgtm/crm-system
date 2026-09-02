-- ── באקט media ─────────────────────────────────────────────────────────────
--
-- תמונות שנכנסות לתוכן שהלקוח רואה: בלוקי תמונה בניוזלטר, ובהמשך גם תמונות
-- הרקע של דפי ההרשמה לאירועים ולקורסים. באקט אחד משותף ולא אחד לכל פיצ'ר,
-- כי כולם אותו סוג נכס עם אותם כללי גישה — ההפרדה היא בתיקייה שבתוכו.
--
-- public = true, באותו נימוק כמו booking-assets (0008): הקוראים הם מייל בתיבה
-- של הנמען ודף נחיתה ציבורי, ולשניהם אין סשן שאפשר לחתום עבורו כתובת זמנית.
-- ההעלאה עוברת דרך service role בלבד (ראו src/lib/media.ts), ולכן אין כאן שום
-- policy ל-anon: גולש אנונימי קורא ולא כותב.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  5242880, -- 5MB. תמונה במייל שגדולה מזה תיחתך אצל חלק מהנמענים ממילא.
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
