# תוכנית בנייה: סרגל חדש, דף בית, ניוזלטר, אירועים וקורסים

מסמך זה הוא מקור האמת היחיד. בצע אותו שלב-שלב, לפי הסדר. כל שלב עומד בפני עצמו:
בסוף כל שלב הריצו את הבדיקות שלו ועשו commit לפני שממשיכים.

כללים מחייבים לכל השלבים:

- לפני כתיבת קוד — קרא את ההנחיה ב-AGENTS.md על גרסת Next.js של הפרויקט.
- אל תשנה נתיבי URL קיימים ואל תזיז תיקיות קיימות.
- אל תיגע ב: `src/app/login`, `src/app/book`, `src/app/oauthcallback`, `src/app/api/webhooks/whatsapp`, `src/app/api/webhooks/quiz`, `scripts/`.
- כל טקסט בממשק — בעברית. המערכת כולה RTL.
- סגנון: השתמש במחלקות הקיימות (`card`, `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-danger`, `input`, `field-label`, `table-wrap`, `th`, `td`) ובמשתני ה-CSS. אל תמציא מערכת עיצוב חדשה.
- מיגרציות: קובץ חדש ב-`supabase/migrations/` עם המספר הרץ הבא הפנוי (בדוק `ls supabase/migrations` — המספור הוא NNNN_name.sql). אחרי כל מיגרציה עדכן את `src/lib/supabase/database.types.ts` באותו סגנון בדיוק כמו הטבלאות הקיימות שם.
- שליחת הודעות: לעולם לא ישירות. הכול דרך `sendMessageToContact` ב-`src/lib/send.ts` — קרא את הקובץ לפני השימוש. כך כל שליחה נרשמת ביומן וכפופה לבלמים הקיימים.
- בדיקות סוף שלב (זהות לכולם): `npx tsc --noEmit` נקי, `npm run lint` נקי, ומעבר ידני על הדפים שהשלב נגע בהם.

---

## סטטוס ביצוע (עודכן 4.9.2026)

| שלב | מצב | קומיט | מיגרציות |
|---|---|---|---|
| 1. סרגל ניווט | ✅ בפרודקשן | — | — |
| 2. דף בית | ✅ בפרודקשן | — | — |
| 3. ניוזלטר | ⚠️ הקוד בפרודקשן, **בדיקת שליחה אמיתית טרם בוצעה** | — | 0022, 0023 |
| 4. אירועים | ✅ בפרודקשן, נבדק מקצה לקצה | `3289d93`, `1467645`, `1e7bf37` | 0024–0027 |
| 5. קורסים | ✅ בפרודקשן, נבדק מקצה לקצה | `e68a0c8` | 0028, 0029 |
| 6. מטא וגרואו | ⚠️ בפרודקשן ונבדק. גרואו מוכנה; **מטא מוגדרת אך אינה מזרימה** | `78c8480` | 0030 |

**החסם היחיד שנותר בשלב 3:** חשבון Postmark טרם אושר אצלם — אפס מיילים יצאו
מהחשבון מעולם. משתני הסביבה בפרודקשן הוגדרו ב-4.9.2026 (הם היו חסרים לגמרי,
ולכן שום מייל לא יצא מהפרודקשן מאז 24.8). ברגע שהחשבון ישוחרר, השליחה תעבוד
בלי שינוי קוד.

**שני החסמים שנותרו בשלב 6, ושניהם מחוץ לקוד:**

1. **מטא לא מזרימה לידים** כי האפליקציה `whtsp-leads` במצב Unpublished, ומטא
   אינה מוסרת webhooks של *דף* לאפליקציה לא מפורסמת — גם לא לאדמין שלה.
   (הוואטסאפ עובד בכל זאת: webhooks של WABA בבעלותך כן נמסרים במצב פיתוח.
   כלל שונה לכל מוצר, לא סתירה.) מסך ה-Publish דורש Privacy Policy URL
   ו-Category, ושניהם ריקים. טיוטת המדיניות מוכנה ב-`מדיניות-פרטיות.md`
   וממתינה לעמוד באתר.
2. **מבנה ה-payload של גרואו טרם נראה.** אין בגרואו כפתור שליחת בדיקה ואין
   לוג שליחות, ולכן הדוגמה הראשונה תהיה של תשלום אמיתי. עד אז החילוץ
   ב-`src/lib/grow.ts` נשאר סלחני, עם TODO מסומן לכיול.

מה שכן עובד: שני ה-endpoints פרוסים ודוחים קריאות לא מאומתות (401 לגרואו,
403 למטא), הוובהוק בגרואו מוגדר ופעיל, והטוקן הקבוע של מטא אומת מול
`debug_token`. `meta_form_targets` ו-`webhook_inbox` ריקות — כלומר טרם נקלט
דבר משני הערוצים.

**אימות פרודקשן — הדומיין הציבורי הוא `crm-system-eight-omega.vercel.app`.**
`crm-system-guy-zuri.vercel.app` וכתובות הפריסה הספציפיות חסומות ב-Vercel SSO
ומחזירות 302 על כל בקשה, כך שבדיקת עשן מולן תמיד "עוברת" ולא בודקת דבר.

---

## שלב 1: צבעי קבוצות וסרגל ניווט חדש

### 1א. צבעים ב-globals.css

בקובץ `src/app/globals.css`, בתוך `:root` (אחרי `--danger-soft`), הוסף:

```css
  /* צבעי קבוצות הניווט */
  --nav-pink: #993556;
  --nav-pink-icon: #d4537e;
  --nav-pink-soft: #fbeaf0;
  --nav-purple: #534ab7;
  --nav-purple-icon: #7f77dd;
  --nav-purple-soft: #eeedfe;
  --nav-coral: #993c1d;
  --nav-coral-icon: #d85a30;
  --nav-coral-soft: #faece7;
  --nav-amber: #854f0b;
  --nav-amber-icon: #ef9f27;
  --nav-amber-soft: #faeeda;
  --nav-blue: #0c447c;
  --nav-blue-icon: #378add;
  --nav-blue-soft: #e6f1fb;
  --nav-gray: #5f5e5a;
  --nav-gray-soft: #f1efe8;
```

### 1ב. רכיב הניווט

צור `src/components/dashboard-nav.tsx` — רכיב לקוח (`"use client"`) שמשתמש ב-`usePathname`. המבנה:

**שורה עליונה:**

1. לוגו: `<Link href="/">` — ריבוע מעוגל (rounded-xl) בצבע `var(--nav-purple)`, ובתוכו אייקון בית קטן (SVG, ראה מטה) והטקסט "CRM" בלבן מודגש. הלוגו הוא כפתור הבית — אין פריט "בית" נפרד בסרגל.
2. שישה פריטי קבוצה, כל אחד `<Link>` לדף הראשון בקבוצה, עם אייקון SVG בצבע `iconColor` של הקבוצה וטקסט. פריט שקבוצתו פעילה מקבל רקע `soft` וצבע טקסט `strong`; השאר `color: var(--muted)`.
3. בקצה (margin-inline-start: auto): כפתור עיגול גלגל שיניים (קישור ל-`/settings`, aria-label="הגדרות המערכת"; כשקבוצת המערכת פעילה — רקע `--nav-gray-soft` וצבע `--nav-gray`), ולידו עיגול פרופיל עם שתי האותיות הראשונות של האימייל באותיות גדולות, רקע `--primary-soft` צבע `--primary`. לחיצה על עיגול הפרופיל (השתמש ב-`<details>` + `<summary>`) פותחת תפריט צף: האימייל המלא + כפתור התנתקות (form עם ה-server action).

**שורה תחתונה (לשוניות משנה):** מוצגת רק כשיש קבוצה פעילה. רקע `bg-[var(--background)]/60` עם border-top. הלשונית הפעילה: רקע לבן, מסגרת `--border-strong`, מעוגלת; השאר `--muted`.

**הגדרת הקבוצות** (סדר מחייב):

| מפתח | תווית | צבעים (soft/strong/icon) | אייקון | לשוניות משנה |
|---|---|---|---|---|
| customers | לקוחות | `--primary-soft` / `--primary` / `--primary` | users | פעילים `/active` · כל אנשי הקשר `/contacts` |
| booking | פגישות | pink | calendar | סוגי פגישות `/booking` · יומן זמינות `/booking/calendar` · פגישות קרובות `/booking/upcoming` · הגדרות `/booking/settings` |
| automation | אוטומציה | purple | route | מסעות לקוח `/journeys` · תבניות הודעה `/templates` · כללים `/rules` |
| newsletter | ניוזלטר | coral | mail | הודעה חדשה `/newsletter` · מתוזמנים `/newsletter/scheduled` · היסטוריה `/newsletter/history` |
| events | אירועים | amber | ticket | כל האירועים `/events` · אירוע חדש `/events/new` |
| courses | קורסים | blue | school | כל הקורסים `/courses` · קורס חדש `/courses/new` |
| system | (אייקון בלבד) | gray | settings | הגדרות `/settings` · וואטסאפ `/whatsapp` |

**לוגיקת סימון:**

- קבוצה פעילה: הנתיב הנוכחי מתחיל באחד מנתיבי המשנה שלה. בנוסף: `/events/<id>` שייך לאירועים ו-`/courses/<id>` לקורסים (התאמת תחילית מכסה זאת), ודף הבית `/` לא מסמן אף קבוצה.
- לשונית פעילה: אם ללשונית יש "אחות" שהנתיב שלה מתחיל בנתיב שלה (כמו `/booking` מול `/booking/calendar`, או `/events` מול `/events/new`) — התאמה מדויקת בלבד; אחרת התאמת תחילית (כדי ש-`/contacts/123` ימשיך לסמן את "כל אנשי הקשר").

**אייקונים** — SVG ישירים בקוד, כולם עם המאפיינים: `width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"`:

- home (בלוגו, בגודל 14): `<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`
- users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`
- calendar: `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`
- route: `<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12"/>`
- mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`
- ticket: `<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>`
- school: `<path d="M22 10v6"/><path d="M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>`
- settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`

### 1ג. החלפת ה-layout הראשי

החלף את `src/app/(dashboard)/layout.tsx`: הוא נשאר server component שקורא `verifyTeamMember`, ומרנדר `<DashboardNav email={email ?? null} signOutAction={signOut} />` ואת ה-`<main>` הקיים. התאם את חתימת `signOutAction` לחתימה האמיתית של `signOut` ב-`src/app/login/actions.ts`.

### 1ד. ניקוי לשוניות כפולות

- החלף את `src/app/(dashboard)/booking/layout.tsx` למעטפת בלבד: `<div className="flex flex-col gap-6">{children}</div>`.
- מחק את `src/app/(dashboard)/booking/tabs.tsx` וכל שימוש ב-`BookingTabs`.
- `src/app/(dashboard)/settings/layout.tsx` נשאר כמו שהוא (הלשוניות הפנימיות שלו הן רמה שלישית).

### בדיקות שלב 1

עבור על כל הדפים הקיימים וודא שהקבוצה והלשונית הנכונות מסומנות, שתפריט הפרופיל נפתח ומתנתק, ושבמסך צר אין גלישה אופקית. הלשוניות של ניוזלטר/אירועים/קורסים יובילו בשלב זה ל-404 — זה צפוי, הדפים נבנים בשלבים הבאים.

---

## שלב 2: דף בית — דאשבורד

### ניתוב

מחק את `src/app/page.tsx` (כיום redirect ל-`/active`) וצור `src/app/(dashboard)/page.tsx` — כך `/` הופך לדף הבית בתוך המעטפת המאובטחת.

### תוכן הדף (מלמעלה למטה)

1. **ברכה:** "בוקר טוב" / "צהריים טובים" / "ערב טוב" לפי שעה בישראל (Asia/Jerusalem) + החלק שלפני ה-@ באימייל. מימין תאריך עברי-לועזי קצר.
2. **ארבעה כרטיסי מדד צבעוניים** בגריד רספונסיבי. כל כרטיס: רקע soft של הקבוצה, מספר גדול (text-2xl, font-medium) בצבע הכהה של הקבוצה, תווית קטנה, ושורת הקשר. כל כרטיס הוא `<Link>` למסך שלו:
   - לקוחות פעילים (teal, קישור `/active`): השתמש באותה שאילתה/קריטריון שכבר משמשים את `src/app/(dashboard)/active/page.tsx` — קרא את הקובץ וחלץ את הספירה באותו אופן. הקשר: כמה אנשי קשר חדשים נוספו ב-7 הימים האחרונים (`contacts.created_at`).
   - פגישות השבוע (pink, קישור `/booking/upcoming`): ספירה מ-`bookings` בין עכשיו לסוף השבוע, והקשר "N היום".
   - הודעות שנשלחו החודש (purple, קישור `/journeys`): ספירת רשומות יוצאות מ-`interactions` מתחילת החודש (קרא את מבנה הטבלה ב-database.types.ts וסנן לפי כיוון/סוג יוצא), והקשר: כמה מסעות פעילים (`journeys` פעילים).
   - הכרטיס הרביעי בשלב זה: מצב וואטסאפ (amber, קישור `/whatsapp`) — "תקין" אם השליחה האחרונה ביומן הצליחה, אחרת אדום עם השגיאה. בשלבי האירועים/קורסים הכרטיס הזה יוחלף בנתוני האירוע הקרוב (ראה שלבים 4–5).
3. **שני חלונות** (גריד שני טורים, `card`):
   - "היום": הפגישות של היום מ-`bookings` (שעה · סוג פגישה · שם איש הקשר, כל שורה מקושרת לאיש הקשר). אם אין — "אין פגישות היום".
   - "דורש טיפול": שתי קטגוריות בשלב זה: (א) אנשי קשר ללא מענה — שחזר את הקריטריון של הטריגר "זמן ללא מענה" מ-`src/lib/automation-engine.ts` (קרא את השאילתה שם והשתמש באותו קריטריון, עם 3 ימים, בלי לשלוח דבר) — הצג עד 5 עם תג כתום "N ימים"; (ב) בשלבים הבאים יתווספו לכאן גם "נרשמו ולא שילמו" ו"מתעניינות בלי מסע". אם אין כלום — "הכול מטופל ✔".
4. **שורת סטטוס תחתונה** — שלושה כרטיסים קטנים (אייקון בריבוע צבעוני soft + שתי שורות טקסט): מצב וואטסאפ, "N אנשים במסעות כרגע" (`journey_enrollments` פעילים), ומצב המתזמן (זמן הריצה האחרונה של הקרון — אם יש טבלת ריצות; אם אין, השמט את הכרטיס השלישי).

כל הנתונים נשלפים בשאילתות מקביליות (`Promise.all`) ישירות בדף (server component), כמו שעושים הדפים הקיימים.

### בדיקות שלב 2

`/` מציג את הדאשבורד עם נתונים אמיתיים; כל כרטיס מוביל למסך הנכון; משתמש לא מחובר מגיע ללוגין.

---

## שלב 3: ניוזלטר

### 3א. מיגרציה

טבלאות חדשות + עמודה:

```sql
create table newsletters (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  blocks jsonb not null default '[]',           -- ראה מבנה בלוקים מטה
  audience jsonb not null default '{"type":"all"}', -- או {"type":"statuses","statuses":[...]}
  status text not null default 'draft',          -- draft | scheduled | sending | sent | canceled
  scheduled_at timestamptz,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now()
);

create table newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  newsletter_id uuid not null references newsletters(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null default 'pending',        -- pending | sent | failed
  error text,
  unique (newsletter_id, contact_id)
);

alter table contacts add column unsubscribed_at timestamptz;
```

מבנה בלוק ב-`blocks`: `{type:'text', html:string}` או `{type:'image', url:string, alt:string}` או `{type:'youtube', videoId:string, caption:string}`.

### 3ב. עורך — `/newsletter`

דף "הודעה חדשה" עם:

- בחירת קהל: צ'יפים — "כל אנשי הקשר (N)" + צ'יפ לכל סטטוס עם ספירה (השתמש ב-`listStatuses` מ-`src/lib/statuses.ts` וב-`statusLabel`). בחירה מרובה. הספירות לא כוללות מוסרים (`unsubscribed_at is null`) וחסרי אימייל.
- שדה נושא.
- עורך בלוקים: רשימת בלוקים אנכית עם שלושה כפתורי הוספה — "טקסט" (textarea, מותר `{{שם}}` ושאר משתני התבניות — קרא את `renderTemplate` ב-`src/lib/templates.ts` לרשימת המשתנים), "תמונה" (העלאת קובץ ל-Supabase Storage, ראה 3ה), "סרטון יוטיוב" (שדה URL; חלץ videoId מכל פורמט מקובל של לינק יוטיוב). לכל בלוק כפתורי מחיקה והזזה מעלה/מטה. עורך פשוט — בלי גרירה, בלי ספריות חדשות.
- שלושה כפתורים: "שלח עכשיו" (btn-primary), "תזמן" (נפתחים שדות תאריך ושעה, btn-secondary), "שלח טיוטה לעצמי" — שולח את המייל המרונדר לאימייל של חבר הצוות המחובר בלבד.
- "שלח עכשיו" = יצירת הרשומה עם `status='scheduled', scheduled_at=now()`. השליחה בפועל תמיד דרך הקרון (3ד) — כך שליחה ל-200 איש לא תיחסם על טיימאאוט של הדפדפן.

### 3ג. רינדור המייל

פונקציה `renderNewsletterHtml(newsletter, contact)` ב-`src/lib/newsletter.ts`:

- טבלת HTML במרכז (רוחב 600px, `dir="rtl"`), רקע לבן, פונט מערכת.
- בלוק טקסט: הפעלת `renderTemplate` על התוכן.
- בלוק תמונה: `<img>` ברוחב מלא, מעוגל.
- בלוק יוטיוב: `<a href="https://www.youtube.com/watch?v={videoId}">` שעוטף `<img src="https://img.youtube.com/vi/{videoId}/hqdefault.jpg">` עם הכיתוב מתחת. אין iframe במיילים.
- פוטר חובה בכל ניוזלטר: "קיבלת את המייל כי נרשמת אצל גיא · להסרה מרשימת התפוצה" — הלינק: `/api/newsletter/unsubscribe?c={contactId}&t={token}`, כאשר token = HMAC-SHA256 של contactId עם הסוד `NEWSLETTER_UNSUB_SECRET` (משתנה סביבה חדש; הוסף ל-`.env.local` ערך זמני ותעד ב-README שצריך להגדירו גם בפרודקשן).

### 3ד. שליחה דרך הקרון

צור `src/lib/newsletter-engine.ts` עם `runNewsletters(now, budgetMs)`, באותו דפוס בדיוק כמו `runTimeSinceNoReplyRules` (קרא אותו קודם):

1. שלוף ניוזלטרים עם `status='scheduled'` ו-`scheduled_at <= now`.
2. לכל אחד: אם אין רשומות נמענים — צור אותן עכשיו (snapshot של הקהל: לפי audience, רק בעלי אימייל, רק `unsubscribed_at is null`), ועדכן `status='sending'`.
3. שלח נמענים `pending` אחד-אחד דרך `sendMessageToContact` (channel email, subject מהניוזלטר, body מ-`renderNewsletterHtml`). עדכן כל רשומה ל-sent/failed. **תקרה: 60 שליחות לריצה** (מכסת Gmail) — מה שלא הספיק ממשיך בריצה הבאה מאותו מקום.
4. כשאין יותר pending: `status='sent'` + עדכון המונים.

חבר לקרון הקיים `src/app/api/cron/check-rules/route.ts`: קרא את חלוקת התקציב הקיימת (כללים/מסעות) והוסף את הניוזלטר כנתח שלישי — למשל 45% כללים, 30% מסעות, 25% ניוזלטר. שמור על אותו דפוס קוד בדיוק.

### 3ה. תמונות

צור bucket ציבורי בשם `media` ב-Supabase Storage (הוסף מיגרציה עם `insert into storage.buckets` אם המיגרציות הקיימות עושות כך; אחרת תעד ב-README שצריך ליצור ידנית — אל תנחש). ההעלאה ב-server action עם `supabaseAdmin().storage`. אותו bucket ישמש גם את תמונות הרקע של דפי האירועים והקורסים (שלבים 4–5) — צור פונקציית עזר משותפת `uploadPublicImage(file, folder)` ב-`src/lib/media.ts`.

### 3ו. הסרה מתפוצה

Route handler ציבורי `src/app/api/newsletter/unsubscribe/route.ts` (GET): מאמת את ה-token, מעדכן `unsubscribed_at=now()`, ומחזיר עמוד HTML פשוט בעברית: "הוסרת מרשימת התפוצה. תמשיכי לקבל רק הודעות אישיות ותפעוליות." אימות כושל → 400 בלי לחשוף סיבה.

חשוב: ההסרה חלה **רק על ניוזלטרים**. מסעות, כללים, תזכורות פגישה והודעות ידניות ממשיכים כרגיל.

### 3ז. דפי משנה

- `/newsletter/scheduled`: רשימת מתוזמנים (נושא, מועד, קהל, סטטוס) עם כפתור "בטל" (מעדכן ל-canceled; זמין רק לפני תחילת שליחה).
- `/newsletter/history`: שנשלחו — נושא, תאריך, נשלחו/נכשלו, וכפתור "שכפל" שפותח את העורך עם התוכן.
- דאשבורד (שלב 2): הוסף לחלון "היום" שורה על הניוזלטר המתוזמן הקרוב, אם קיים.

### בדיקות שלב 3

שלח טיוטה לעצמך וקבל אותה בפועל; תזמן ניוזלטר לדקה הקרובה ל-2–3 אנשי קשר אמיתיים שלך בלבד (לא לכל הרשימה!), הרץ את הקרון ידנית (GET עם ה-Authorization הנכון) וודא קבלה; לחץ על לינק ההסרה וודא שהמוסרת לא נכללת בקהל הבא.

---

## שלב 4: אירועים

### 4א. מיגרציה

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                     -- לכתובת הציבורית
  name text not null,                            -- גם הכותרת הראשית בדף ההרשמה
  subtitle text,                                 -- כותרת משנה מתחת לכותרת
  description text,
  starts_at timestamptz not null,
  location text,
  capacity int,                                  -- null = בלי הגבלה
  grow_link text,                                -- לינק תשלום מגרואו
  custom_fields jsonb not null default '[]',     -- [{key,label,type:'text'|'select',options:[]}]
  -- עיצוב דף ההרשמה
  header_image_url text,                         -- תמונת רקע לחלק העליון (מה-bucket media)
  form_description text,                         -- תיאור קצר בתוך הטופס
  button_text text not null default 'המשך לתשלום מאובטח בגרואו',
  show_datetime boolean not null default true,   -- הצגת תאריך/שעה/מיקום
  show_capacity boolean not null default true,   -- הצגת "נותרו N מקומות"
  -- עיצוב דף התודה
  thankyou_title text not null default 'ההרשמה נקלטה!',
  thankyou_text text,
  thankyou_show_calendar boolean not null default true,
  thankyou_show_image boolean not null default false,
  remind_day_before boolean not null default true,
  remind_hour_before boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  stage text not null default 'interested',      -- interested | registered | paid
  source text not null default 'landing',        -- landing | meta | manual
  answers jsonb not null default '{}',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (event_id, contact_id)
);

create table event_reminders_sent (
  registration_id uuid not null references event_registrations(id) on delete cascade,
  kind text not null,                            -- day_before | hour_before
  sent_at timestamptz not null default now(),
  primary key (registration_id, kind)
);
```

### 4ב. דף ציבורי — `src/app/event/[slug]/page.tsx`

מחוץ ל-(dashboard), ציבורי כמו `/book` (קרא את `src/app/book` והשתמש באותם דפוסים של עמוד ציבורי). מבנה הדף, מלמעלה למטה, לפי שדות העיצוב מהטבלה:

- **חלק עליון:** אם יש `header_image_url` — התמונה כרקע עם שכבת הכהיה (`rgba(0,0,0,0.35)`) והכותרות בלבן עליה; בלי תמונה — רקע `--primary` מלא. בתוכו `name` (גדול) ו-`subtitle` (קטן, בהיר) במרכז.
- שורת תאריך-שעה-מיקום — רק אם `show_datetime`. "נותרו N מקומות" (capacity פחות paid) — רק אם `show_capacity`. אם מלא — הטופס מוחלף ב"האירוע מלא" ואיסוף לרשימת המתנה כ-interested.
- `form_description` אם קיים — פסקה קצרה בראש הטופס.
- טופס: שם מלא, טלפון, אימייל + השדות המותאמים מ-custom_fields.
- כפתור השליחה עם הטקסט מ-`button_text`.

שליחה (server action):

1. אתר-או-צור איש קשר לפי טלפון/אימייל — השתמש באותה לוגיקת upsert שכבר קיימת ב-webhook של השאלון (`src/app/api/webhooks/quiz/route.ts`) — קרא ושכפל את הדפוס, אל תמציא חדש.
2. צור/עדכן `event_registrations` ל-stage `registered` (אם הייתה interested — שדרג).
3. אם יש `grow_link` — redirect אליו; אחרת ישר לעמוד התודה. (כשיש תשלום, עמוד התודה מוצג אחרי התשלום: בהגדרות דף התשלום בגרואו מגדירים את כתובת עמוד התודה ככתובת ההפניה לאחר תשלום מוצלח — זה חלק מההגדרות שנעשות מול גרואו בסוף, ראה הסעיף האחרון. עמוד התודה חייב לכן לעבוד גם בכניסה ישירה מבחוץ, בלי תלות ב-session או בפרמטרים מהטופס.)

**עמוד התודה** `src/app/event/[slug]/thanks/page.tsx`: עיגול ✔ ירוק, `thankyou_title`, `thankyou_text`, ואם `thankyou_show_image` — תמונת הרקע גם כאן. אם `thankyou_show_calendar` — שני כפתורי "הוספה ליומן":

- **יומן Google:** לינק `https://calendar.google.com/calendar/render?action=TEMPLATE&text={שם}&dates={start}/{end}&location={מיקום}&details={תיאור}` (זמנים בפורמט UTC `YYYYMMDDTHHMMSSZ`; אם אין שעת סיום — שעתיים אחרי ההתחלה).
- **יומן אחר (ICS):** קישור ל-route handler חדש `src/app/api/events/[id]/ics/route.ts` שמחזיר קובץ `text/calendar` (VCALENDAR/VEVENT תקני עם SUMMARY, DTSTART, DTEND, LOCATION, DESCRIPTION) עם header של הורדה בשם `event.ics`.

### 4ג. ניהול פנימי

- `/events`: רשימת אירועים (`card` לכל אירוע: שם, תאריך, שלושה מונים paid/interested/registered-לא-שילמו, תג "פעיל"/"עבר").
- `/events/new`: טופס יצירה עם שדות הבסיס בלבד (שם, תאריך, מיקום, קיבולת, לינק גרואו, תזכורות). אחרי שמירה — מעבר אוטומטי לעורך העיצוב.
- `/events/[id]/edit` — **עורך העיצוב**, רכיב לקוח עם שלוש לשוניות ותצוגה חיה:
  - פריסה: שני טורים — טור הגדרות ולידו תצוגה מקדימה חיה של הדף הציבורי (רכיב תצוגה משותף! חלץ את הרינדור של דף ההרשמה ודף התודה לרכיבי תצוגה ב-`src/components/` שמקבלים את נתוני האירוע כ-props, והשתמש בהם גם בדף הציבורי וגם בתצוגה החיה — כך אין שני עותקים של העיצוב). התצוגה מתעדכנת עם כל שינוי בשדות (state מקומי; שמירה בכפתור "שמור" יחיד דרך server action).
  - לשונית "דף ההרשמה": העלאת תמונת רקע (דרך `uploadPublicImage` מ-3ה, עם תצוגת התמונה הנוכחית וכפתורי החלף/הסר), כותרת (name), כותרת משנה, תיאור קצר בטופס, טקסט כפתור, ושני מתגים — הצגת תאריך/שעה/מיקום והצגת מקומות שנותרו.
  - לשונית "דף התודה": כותרת, טקסט, מתג "הוספה ליומן", מתג "הצג את תמונת הרקע גם כאן".
  - לשונית "שדות הטופס": עורך השדות המותאמים (הוספת שדה: תווית + סוג טקסט/בחירה, מחיקה, שינוי סדר) + שדות הבסיס של האירוע (תאריך, מיקום, קיבולת, לינק גרואו, תזכורות).
- `/events/[id]`: מסך הניהול — שלושה מוני מדד למעלה, טבלת אנשים עם תגי שלב צבעוניים (שילמה=ירוק soft, מתעניינת=amber soft, לא שילמה=pink soft) ועמודת מקור, כפתורים: "העתק לינק הרשמה" (ללוח), "עיצוב הדף" (לעורך), "סמן כשילמה" ידני לכל שורה (fallback לגרואו), ו"מסע למתעניינות" (ראה 4ה).

### 4ד. תזכורות

ב-`src/lib/event-engine.ts` פונקציה `runEventReminders(now, budgetMs)` באותו דפוס של המנועים הקיימים: אירועים פעילים שמתחילים בעוד 20–28 שעות (day_before) או 50–70 דקות (hour_before), לכל רשומת paid שלח וואטסאפ דרך `sendMessageToContact` ("תזכורת: {שם האירוע} מחר/בעוד שעה ב-{שעה}, {מקום}. נתראה!") ורשום ב-`event_reminders_sent` (הרשומה מונעת כפל — בדוק לפניה). חבר כנתח רביעי לקרון (עדכן את החלוקה: 40/25/20/15).

### 4ה. מסע למתעניינות

קרא איך מוגדרים טריגרי הכניסה של מסעות (`src/app/(dashboard)/journeys` + `src/lib/journey-engine.ts`) והוסף סוג טריגר כניסה חדש: "נרשמה כמתעניינת לאירוע" עם בחירת אירוע — באותו דפוס בדיוק כמו הטריגרים הקיימים, כולל בורר בממשק המסעות. כשנוצרת `event_registrations` עם stage=interested, צרף את איש הקשר למסעות שמאזינים לאירוע הזה (באותו מקום בקוד שבו טריגרים קיימים מצרפים). הכפתור "מסע למתעניינות" במסך האירוע מוביל ל-`/journeys` עם פרמטר שפותח יצירת מסע עם הטריגר הזה מסומן מראש.

### 4ו. דאשבורד

החלף את כרטיס המדד הרביעי בדף הבית: האירוע הקרוב — "N/קיבולת נרשמו" עם פס התקדמות דקיק בצבע amber, קישור למסך האירוע. אם אין אירוע קרוב — השאר את כרטיס הוואטסאפ. הוסף ל"דורש טיפול": "נרשמו ולא שילמו" (stage=registered מעל 24 שעות).

### בדיקות שלב 4

צור אירוע אמיתי, העלה לו תמונת רקע ושנה כותרת/כפתור בעורך וודא שהתצוגה החיה והדף הציבורי זהים; הירשם דרך הדף הציבורי בפרטים שלך, ודא שנוצר איש קשר ורשומה, סמן ידנית כשילמה, ודא שהמונה והקיבולת מתעדכנים; בעמוד התודה בדוק ששני כפתורי היומן עובדים — לינק Google פותח אירוע נכון וקובץ ה-ICS נפתח ביומן עם התאריך והמיקום הנכונים.

---

## שלב 5: קורסים דיגיטליים ✅ הושלם (4.9.2026, `e68a0c8`)

> **מה שנעשה אחרת מהכתוב מטה, ולמה:**
>
> 1. **הרכיבים המשותפים שונו במקום להיות מועתקים.** `components/event-page.tsx`
>    הפך ל-`registration-page.tsx` (שדות תאריך/מקום/קיבולת אופציונליים,
>    האקספורטים `Event*` → `Registration*`), `copy-embed.tsx` עבר ל-`components/`
>    עם פרופ `kind`, ו-`findOrCreateContact`/`strongerStage`/`slugify` עברו
>    מ-`lib/events.ts` ל-**`lib/registration.ts`** (`findOrCreateContact` מקבל
>    `sourceLabel` מלא). קורס ואירוע חולקים עכשיו רינדור אחד.
> 2. **הכרטיס בשורת הסטטוס נוסף ולא הוחלף.** התוכנית כתבה "החלף את הכרטיס
>    השלישי", אבל שלב 2 הורה במפורש להשמיט אותו כשאין טבלת ריצות קרון — ולכן
>    היו שם שניים בלבד. הכרטיס של הקורסים הוא השלישי החדש.
> 3. **סוג הודעת ה-postMessage נשאר `crm-event-height`** גם בקורסים. זהו
>    פרוטוקול על החוט: קוד ההטמעה של האירוע כבר מודבק בדף נחיתה חי בוורדפרס,
>    ושינוי המחרוזת היה שובר שם את התאמת הגובה בשקט.
> 4. **טופס יצירת המסע הועבר ל-`toResult`/`ActionForm`** — נוספה לו הודעת
>    שגיאה חדשה, ובדפוס ה-`throw` הישן היא לא הייתה מגיעה למשתמש בפרודקשן.
>
> **נבדק בפועל** (קורס זמני שנמחק אחריו): הרשמה דרך iframe חוצה-מקור עם
> התאמת גובה, שמירת שדה מותאם, יצירת איש קשר עם תגית, רישום `course_registered`
> ביומן, `contact_activity` שמחזירה אותו, רידיירקט לגרואו שלוקח את `window.top`,
> ו-`journeys.entry_type='course_interest'` שהתקבל במסד.
>
> **לא נבדק:** עורך העיצוב והתצוגה החיה — דורשים התחברות.

לפני שמתחילים: קיימת כבר טבלת `course_leads` (מיגרציה 0013) ו-webhook ב-`src/app/api/webhooks/course` מדף נחיתה קיים של קורס המדיטציה. קרא את שניהם. אל תשבור אותם — הם ממשיכים לעבוד כמו שהם. המבנה החדש בנפרד, ובסוף השלב חבר: כל course_lead חדש שנקלט ב-webhook הקיים יירשם גם כ-interested בקורס המתאים אם הוגדר mapping (עמודת `legacy_webhook` בטבלת courses שמסומנת לקורס אחד לכל היותר).

### 5א. מיגרציה

`courses` — כמו events אך בלי starts_at/location/capacity/תזכורות ובלי show_datetime/show_capacity/thankyou_show_calendar (אין תאריך — אין יומן), ועם `grow_link` ו-`legacy_webhook boolean default false`. שדות העיצוב האחרים (subtitle, header_image_url, form_description, button_text, thankyou_title, thankyou_text, thankyou_show_image) — זהים. `course_registrations` — זהה במבנה ל-event_registrations (stage: interested | registered | paid).

### 5ב. טופס הרשמה להטמעה

- `src/app/course/[slug]/page.tsx` — עמוד ציבורי מלא (כמו אירוע, בלי קיבולת ותאריך; אותם שדות עיצוב ואותם רכיבי תצוגה משותפים).
- `src/app/course/[slug]/embed/page.tsx` — גרסה מינימלית להטמעה ב-iframe: רק כרטיס הטופס — `form_description` אם קיים, שם/טלפון/אימייל, וכפתור עם `button_text` — **בלי** תמונת הרקע והכותרות (העמוד המארח מביא את העיצוב שלו). אל תוסיף לנתיב הזה כותרות X-Frame-Options/CSP חוסמות, ואם קיימת הגדרת headers גלובלית ב-`next.config.ts` — החרג אותו.
- הרשמה: אותו flow כמו אירוע (upsert איש קשר → registration → redirect לגרואו).
- במסך הניהול: "העתק קוד הטמעה" מעתיק ללוח `<iframe src="{origin}/course/{slug}/embed" style="width:100%;max-width:420px;height:430px;border:0;" title="הרשמה לקורס"></iframe>` ו"העתק לינק ישיר" את העמוד המלא.

### 5ג. ניהול, מסעות ודאשבורד

- `/courses`, `/courses/new`, `/courses/[id]`, `/courses/[id]/edit` — שיקוף מדויק של מסכי האירועים, כולל עורך העיצוב עם התצוגה החיה (בלי תזכורות, קיבולת, מתגי תאריך/מקומות וכפתור היומן). מוני המדד: "לקוחות בקורס" (paid), "מתעניינות", "התחילו ולא שילמו".
- טריגר כניסה למסע: "נרשמה כמתעניינת לקורס" — הרחב את מה שנבנה ב-4ה באותו אופן.
- דאשבורד: בשורת הסטטוס התחתונה החלף את הכרטיס השלישי ב"מתעניינות בקורסים" (סה"כ interested פתוחות + כמה חדשות השבוע, כחול). הוסף ל"דורש טיפול": מתעניינות (אירוע או קורס) שלא מצורפות לאף מסע.

### בדיקות שלב 5

צור קורס, פתח את `/course/{slug}/embed` בתוך קובץ HTML מקומי עם iframe, הירשם דרכו, ודא קליטה במערכת ורידיירקט לגרואו.

---

## שלב 6: קליטת לידים ממטא ותשלומים מגרואו (תשתית בלבד)

ההפעלה מול מטא וגרואו נעשית עם גיא ביחד, לא בשלב הזה. כאן בונים רק את הצד שלנו:

### 6א. תיבת דואר נכנס ל-webhooks

מיגרציה: `webhook_inbox (id, source text, payload jsonb, processed boolean default false, error text, created_at)`. כל payload נכנס נשמר בה לפני עיבוד — כך אפשר לאבחן פורמטים אמיתיים של מטא/גרואו בלי לאבד מידע.

### 6ב. מטא — `src/app/api/webhooks/meta-leads/route.ts`

בנה במראה של ה-webhook הקיים של וואטסאפ (`src/app/api/webhooks/whatsapp/route.ts` — קרא אותו): GET לאימות `hub.challenge` עם `META_LEADS_VERIFY_TOKEN` (env חדש), POST שקולט leadgen: שמור ב-inbox, חלץ שם/טלפון/אימייל מ-field_data (בסלחנות — שמות שדות משתנים בין טפסים), upsert איש קשר, וצור registration בשלב interested עם source='meta'. שיוך ליד לאירוע/קורס: טבלת mapping `meta_form_targets (form_id text primary key, target_type text, target_id uuid)` + מסך ניהול קטן תחת `/settings` ("טפסי מטא") שבו משייכים form_id לאירוע או קורס. form_id שלא ממופה — נשאר ב-inbox עם processed=false ומופיע בהתראה במסך ההגדרות.

### 6ג. גרואו — `src/app/api/webhooks/grow/route.ts`

POST בלבד, מאומת בסוד ב-query (`GROW_WEBHOOK_SECRET` env חדש). שמור ב-inbox. עיבוד: התאם registration לפי אימייל או טלפון מה-payload מול רשומות registered/interested פתוחות, ועדכן ל-paid + `paid_at`. אם אין התאמה חד-משמעית — השאר processed=false. אל תנחש את מבנה ה-payload של גרואו: כתוב חילוץ סלחני (חפש מפתחות email/phone/customerEmail וכד') והשאר TODO מסומן לכיול אחרי ה-payload האמיתי הראשון.

### בדיקות שלב 6

שלח POST-ים מדומים לשני ה-endpoints עם curl וודא: שמירה ב-inbox, יצירת מתעניינת ממטא עם mapping, סימון paid מגרואו, ודחיית קריאות בלי טוקן/סוד.

---

## מה נשאר לגיא ולקלוד לעשות ביחד (לא חלק מהמסמך הזה)

עודכן 4.9.2026. כל שורה כאן נבדקה מול המערכת עצמה ולא מול הזיכרון.

**פתוח:**

- **עמוד מדיניות פרטיות באתר** → הכתובת ל-Meta App settings → Basic, יחד עם
  Category → Publish. זה החסם היחיד שמפריד בין המערכת לבין לידים אמיתיים ממטא.
  הטקסט מוכן ב-`מדיניות-פרטיות.md`.
- **הפניה אחרי תשלום בגרואו**, לכל דף תשלום של אירוע/קורס: כתובת ההפניה
  לאחר תשלום מוצלח → עמוד התודה של אותו אירוע/קורס. טרם הוגדר, והאירוע
  הפעיל כבר עם `grow_link` חי — כלומר מי שמשלמת נוחתת כרגע בדף של גרואו
  ולא ב"ההרשמה נקלטה!" שהוגדר במערכת.
- **אישור חשבון Postmark** — ראו החסם בשלב 3. עד אז אפס מיילים יוצאים.
- **שליחת ניוזלטר ראשון אמיתי** במנות קטנות, אחרי שהחשבון ישוחרר. (המכסות
  הרלוונטיות הן של Postmark; המעבר מ-Gmail כבר נעשה.)
- **שיוך שני טפסי מטא** ב-`/settings/meta-forms`, כשיהיה להם אירוע או קורס
  לשייך אליו. כרגע אין.

**נסגר:**

- ~~הגדרת האפליקציה במטא~~ — מנוי ל-leadgen, טוקן דף קבוע (תפוגה: Never)
  ואימות ה-webhook מול הפרודקשן. הכל בוצע ואומת מול `debug_token`.
- ~~בדיקה אם גרואו תומכת ב-webhooks~~ — תומכת. "CRM — תשלומים" מוגדר ופעיל,
  JSON, כל העסקאות.
- ~~משתני הסביבה בפרודקשן~~ — `NEWSLETTER_UNSUB_SECRET`,
  `META_LEADS_VERIFY_TOKEN`, `GROW_WEBHOOK_SECRET`, `META_LEADS_PAGE_TOKEN`.
- ~~ה-bucket `media`~~ — קיים (public), לצד `booking-assets`.
