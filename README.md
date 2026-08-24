# CRM — ManyChat + Gmail + Next.js/Supabase

מימוש של האפיון "מערכת CRM" (ManyChat ⟷ קוד ⟷ Gmail, בלי Make). הפרויקט **בנוי ועובר build נקי**, אבל לא מחובר עדיין לחשבונות אמיתיים — ר' [הקמה מאפס](#הקמה-מאפס) לפני שמנסים להריץ אותו על אמת.

## ארכיטקטורה

```
ManyChat  ──webhook (External Request)──▶  /api/webhooks/manychat  ┐
                                                                     │
ManyChat  ◀────────── ManyChat API ─────────  automation-engine ───┤── Supabase (Postgres)
                                                                     │
תיבת Gmail ◀──────────  Gmail API ──────────  automation-engine ───┘
                                                     ▲
                                          /api/cron/check-rules (יומי)
                                                     ▲
                                              דשבורד (Next.js, Supabase Auth)
```

הקוד הוא ה"מוח" בשני הכיוונים — הוא מחליט מתי ולמי לשלוח, בלי מתווכים. ר' [האפיון המקורי](#) שסופק לפרויקט לפרטים המלאים; המסמך הזה מתמקד במה שבפועל נבנה ובמה שעדיין צריך להשלים.

## סטאק

Next.js 16 (App Router, Turbopack) · Postgres + Auth דרך Supabase · Vercel (hosting + cron) · Gmail API (OAuth2) · ManyChat API. בדיוק כמו באפיון המקורי, סעיף 2.

**הערה על Next.js 16:** הגרסה הזו החליפה `middleware.ts` ב-`proxy.ts` (אותה מנגנון, שם אחר) ושינויים נוספים לא-שגרתיים. אם ממשיכים לפתח כאן עם עוזר AI — יש `AGENTS.md` בשורש שמפנה למסמכי הגרסה הנכונה תחת `node_modules/next/dist/docs/`; שווה לוודא שהוא עדיין שם ורלוונטי לפני שינויים גדולים.

## מה כבר בנוי

- **סכימת DB מלאה** (`supabase/migrations/0001_init.sql`) — כל 5 הטבלאות מהאפיון + 2 תוספות (ר' למטה), הרשאות RLS, טריגר שמוסיף `team_members` אוטומטית כשמזמינים משתמש חדש ב-Supabase Auth.
- **כל ה-endpoints מסעיף 4**: `/api/webhooks/manychat`, `/api/cron/check-rules`, `/api/contacts` (+ `/[id]`), `/api/send/email`, `/api/send/whatsapp`.
- **מנוע הכללים** (`src/lib/automation-engine.ts`) — status_change + time_since_no_reply, כולל בדיקת חלון 24 השעות ובחירה בין הודעה חופשית לפלואו-תבנית.
- **דשבורד מלא**: התחברות (Supabase Auth), רשימת אנשי קשר עם סינון, כרטיס איש קשר עם לוג אינטראקציות ועדכון סטטוס/הערות, ניהול כללי אוטומציה, ניהול תבניות הודעה.
- **`npm run build` עובר נקי** (TypeScript + ESLint + Next build) — נבדק בפועל, כולל הרצת dev server ובדיקת מספר endpoints ידנית (ראו קוד/היסטוריית העבודה אם רוצים לשחזר את הבדיקות).

## שינויים והוספות לעומת האפיון המקורי

כמה החלטות שהתקבלו תוך כדי בנייה, שלא היו מפורשות באפיון:

1. **`contacts.manychat_subscriber_id` (שדה חדש)** — ה-API של ManyChat שולח הודעות לפי `subscriber_id`, לא לפי מספר טלפון; לפי הקהילה של ManyChat, שליפת ה-ID לפי טלפון בדיעבד היא כאב ראש ידוע (`findByCustomField` לא עובד טוב למנויי WhatsApp). לכן אנחנו שומרים אותו פעם אחת, כשה-webhook הראשון מגיע.
2. **`automation_rule_runs` (טבלה חדשה)** — בלי זיכרון של "הכלל הזה כבר רץ על איש הקשר הזה", ה-cron היומי לכללי `time_since_no_reply` היה שולח את אותה הודעה **כל יום מחדש** לכל מי שחצה את הסף. הטבלה הזו מונעת את זה.
3. **`message_templates.manychat_template_id` = flow_ns, לא שם תבנית** — אין ל-ManyChat endpoint ששולח תבנית מאושרת של Meta לפי שם. שולחים אותה על ידי הפעלת **Flow** ב-ManyChat שהצעד הראשון שלו הוא הודעת התבנית המאושרת (`POST /fb/sending/sendFlow`). כלומר צריך לבנות פלואו כזה ידנית בממשק של ManyChat לכל תבנית חיצונית-לחלון, ולשים כאן את ה-`flow_ns` שלו.
4. **RLS + service role, לא RLS בלבד** — הדשבורד/ה-API מדברים עם Supabase דרך מפתח ה-service role (עוקף RLS), כי "כולם באותה הרשאה" זה בדיוק המודל שלא צריך RLS-per-user. מדיניות ה-RLS עדיין קיימת בטבלאות כקו הגנה שני, למקרה שמפתח ה-anon ייחשף אי-פעם לצד לקוח.
5. **הדשבורד קורא מ-Supabase ישירות, לא דרך `/api/contacts`** — ה-endpoint קיים (לפי דרישת סעיף 4), אבל דפי הדשבורד עצמם קוראים ישירות דרך ה-Server Client של Supabase (הדפוס המקובל ב-App Router) כדי לא לעשות קריאת HTTP מיותרת לעצמם.
6. **דה-דופליקציה על ה-webhook הנכנס** — ManyChat לא מבטיח דליברי חד-פעמי; אם מגיע payload עם `last_interaction` שלא מאוחר מהערך השמור, זה מטופל כ"כבר קיים" (לא נרשם פעמיים, לא מפעיל כללים פעמיים).
7. **"External Request" ב-ManyChat הוא פיצ'ר PRO** — זו כנראה בדיוק הכוונה בסעיף 7 המקורי ("לוודא שהחשבון תומך בקריאות API יוצאות") — זו לא רק שאלה של "יש מפתח API", אלא של תוכנית המנוי.

## הקמה מאפס

### 1. Supabase

1. צרו פרויקט חדש ב-[supabase.com](https://supabase.com).
2. SQL Editor ← הדביקו את התוכן של `supabase/migrations/0001_init.sql` והריצו (או `supabase link` + `supabase db push` אם עובדים עם ה-CLI).
3. Project Settings → API — העתיקו `URL`, `anon public key`, ו-`service_role secret` ל-`.env.local` (ר' `.env.example`).
4. **הוספת אנשי צוות** (אין הרשמה עצמאית במערכת, בכוונה): Authentication → Users → Add user, מלאו אימייל+סיסמה, סמנו Auto Confirm. הטריגר ב-migration יוסיף אותם אוטומטית ל-`team_members`. *(שיפור עתידי אפשרי: מסך "שכחתי סיסמה"/הזמנה עצמאית — לא נבנה ב-v1 הזה.)*
5. כשמחברים לפרויקט אמיתי, כדאי לייצר את הטיפוסים מהסכימה החיה במקום `src/lib/supabase/database.types.ts` הידני:
   ```bash
   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
   ```
   (ואז לוודא שהוא עדיין תואם למה שהקוד מצפה לו — הוא נשען על זה שלכל טבלה יש `Relationships: []`, ר' הערה בקובץ.)

### 2. ManyChat

1. **קודם כול תבדקו את תוכנית המנוי** — "External Request" (השלב שדרכו ManyChat קורא ל-webhook שלנו) הוא פיצ'ר PRO. בלי זה, הצד "ManyChat → הקוד" לא יעבוד בכלל.
2. Settings → API → generate token → `MANYCHAT_API_TOKEN`.
3. תבחרו מחרוזת אקראית משלכם ל-`MANYCHAT_WEBHOOK_SECRET` (`openssl rand -hex 24`).
4. בממשק של ManyChat: Automation → צרו/ערכו פלואו עם טריגר "הודעה חדשה" (או מה שמתאים לזרימה שלכם) → **+ Action → External Request**:
   - Method: `POST`
   - URL: `https://<הדומיין-שלכם>/api/webhooks/manychat`
   - Header: `X-Webhook-Secret: <MANYCHAT_WEBHOOK_SECRET>`
   - Body: השתמשו בכפתור **"Add Full Subscriber Data"** — זה בונה JSON עם אובייקט המנוי המלא, שזה בדיוק מה ש-`parseManyChatSubscriber` (ב-`src/lib/manychat.ts`) מצפה לפרסר.
5. לכל תבנית וואטסאפ ש**צריכה לצאת מחוץ לחלון 24 השעות**: בנו פלואו נפרד שהצעד הראשון שלו הוא הודעת התבנית המאושרת (חייבת להיות כבר מאושרת ב-Meta/WhatsApp Business — זה עדיין באחריותכם, סעיף 7 המקורי), והכניסו את ה-`flow_ns` שלו בשדה `manychat_template_id` כשיוצרים את התבנית בדשבורד.
6. שדות ה-JSON המדויקים (`whatsapp_phone` מול `phone`, שם השדה עם ה-timestamp וכו') **לא אומתו מול חשבון אמיתי** — `src/lib/manychat.ts` כתוב באופן סלחני (בודק כמה שמות שדה אפשריים) בדיוק בגלל זה. ברגע שיש payload אמיתי, שווה לוג אותו פעם אחת ולוודא/לחדד את `parseManyChatSubscriber`.

### 3. Gmail (Google Cloud OAuth2)

1. [Google Cloud Console](https://console.cloud.google.com) → פרויקט חדש (או קיים) → **APIs & Services → Library** → הפעילו את **Gmail API**.
2. **APIs & Services → OAuth consent screen** — סוג External (חשבון Gmail רגיל, לא Workspace, אין אפשרות Internal). כל עוד המסך במצב **Testing**: רק "Test users" שתוסיפו יכולים להרשות גישה — תוסיפו שם את חשבון ה-Gmail השולח. **חשוב:** במצב Testing, ה-refresh token פג אחרי כ-7 ימים — אם לא רוצים לחדש אותו ידנית כל שבוע, יהיה צריך "לפרסם" (Publish) את המסך; בגלל שההיקף `gmail.send` נחשב רגיש, פרסום מלא עשוי לדרוש תהליך אימות של גוגל. שיקלול הפשרה הזו הוא בעצם סעיף 7 המקורי ("האם צריך OAuth consent screen מאומת") — עדיין החלטה פתוחה.
3. **Credentials → Create Credentials → OAuth client ID → Web application** → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. קבלת `GOOGLE_REFRESH_TOKEN` (חד-פעמי, הכי פשוט עם [Google OAuth Playground](https://developers.google.com/oauthplayground)):
   - ⚙️ (הגדרות) → Use your own OAuth credentials → הדביקו Client ID/Secret.
   - כדי שזה יעבוד, צריך להוסיף את כתובת ה-redirect של ה-Playground (`https://developers.google.com/oauthplayground`) לרשימת ה-Authorized redirect URIs של ה-OAuth Client ב-Google Cloud.
   - Step 1: בחרו scope `https://www.googleapis.com/auth/gmail.send` → Authorize APIs → התחברו עם חשבון ה-Gmail השולח.
   - Step 2: Exchange authorization code for tokens → העתיקו את ה-`refresh_token`.
5. מלאו גם `GMAIL_SENDER_EMAIL` (חשבון השולח בפועל) ו-`GMAIL_SENDER_NAME` (השם שמוצג לנמענים).
6. מכסת שליחה: חשבון Gmail רגיל מוגבל בערך ל-500 מיילים ביום, Workspace בערך 2,000 — שווה לוודא מול [התיעוד העדכני](https://support.google.com/a/answer/166852) אם זה עדיין רלוונטי, אבל בנפח שדיברתם עליו (50–200 לידים/חודש) יש המון מרווח.

### 4. דומיין + Vercel

1. `vercel deploy` (או חיבור ה-repo ב-Vercel dashboard).
2. Project Settings → Environment Variables — הזינו את כל מה שב-`.env.example`.
3. `vercel.json` כבר מגדיר cron יומי ל-`/api/cron/check-rules` בשעה 06:00 UTC (≈ 8–9 בבוקר בישראל, תלוי שעון קיץ) — שנו את ה-schedule אם רוצים שעה אחרת. ברגע שמגדירים `CRON_SECRET` כמשתנה סביבה, Vercel שולח אותו אוטומטית כ-`Authorization: Bearer <CRON_SECRET>` — אין צורך בקוד נוסף.
4. הדומיין הסופי (זמני מ-Vercel כמו `your-app.vercel.app`, או דומיין קסטום) הוא מה שהולך ב-URL של ה-External Request ב-ManyChat (סעיף 7 המקורי, פריט 5 — עדיין צריך להחליט/לחבר).

## פיתוח מקומי

```bash
npm install          # כבר רץ; מריצים שוב רק אם עדכנתם package.json
cp .env.example .env.local   # ואז למלא ערכים אמיתיים
npm run dev
```

`npm run build` ו-`npx eslint .` רצים נקי גם בלי חיבור לחשבונות אמיתיים (עם `.env.local` שמכיל ולו ערכים placeholder בפורמט הנכון) — שימושי כבדיקת "לא שברתי כלום" תוך כדי פיתוח.

## מבנה הפרויקט

```
supabase/migrations/0001_init.sql   סכימת ה-DB המלאה
src/proxy.ts                        רענון session + הפניה ל-/login (היה נקרא middleware.ts לפני Next 16)
src/lib/
  supabase/{server,admin,client}.ts שלושה קליינטים שונים בכוונה — ר' הערות בקבצים
  manychat.ts, gmail.ts             אינטגרציות חיצוניות
  send.ts                           הליבה המשותפת: שולח + רושם ל-interactions
  automation-engine.ts              מנוע הכללים, בונה מעל send.ts
  templates.ts                      רינדור {{full_name}} וכו'
  dal.ts, api-auth.ts               בדיקת session — לעמודי דשבורד ול-API routes, בהתאמה
src/app/
  api/                              כל ה-endpoints מסעיף 4 באפיון
  login/                            התחברות (Server Action, בלי חשיפת client Supabase)
  (dashboard)/                      אנשי קשר, כללי אוטומציה, תבניות — כולם מאחורי proxy.ts
```

## מה עוד לא בנוי

- מסך "שכחתי סיסמה" / הזמנת צוות עצמאית מתוך הדשבורד (כרגע: Supabase Studio בלבד).
- שום דבר לא נבדק מול חשבונות אמיתיים של ManyChat/Gmail/Supabase — כל האינטגרציה נכתבה לפי תיעוד ציבורי + קוד מקור של הספריות, לא נבדקה end-to-end. תכננו זמן לניפוי-באגים בסבב הבדיקה הראשון מול חשבונות אמיתיים.
- קריאת תגובות/אימיילים נכנסים מ-Gmail (האפיון ביקש שליחה בלבד).
- טסטים אוטומטיים.

---

## שאלון הצ'אקרות → CRM

השאלון (`../index.html`) שולח כל מילוי ל-`POST /api/webhooks/quiz`, ומשם הוא נשמר
בטבלה `quiz_submissions` ומתחבר ל-`contacts` הקיימת.

### הפעלה

1. הריצו את `supabase/migrations/0002_quiz.sql` ב-SQL editor.
2. ב-`.env.local` הוסיפו `QUIZ_ALLOWED_ORIGIN` (הדומיין של השאלון), ואם רוצים גם
   `QUIZ_WEBHOOK_SECRET`.
3. ב-`index.html` הגדירו:
   ```js
   WEBHOOK_URL: "https://<הדומיין>/api/webhooks/quiz",
   WEBHOOK_SECRET: "",   // רק אם הגדרתם QUIZ_WEBHOOK_SECRET
   ```

### שלוש רשומות, שורה אחת

| מתי | `kind` | מה קורה |
|---|---|---|
| בסיום השאלון | `anonymous` | נשמרת התוצאה וכל 21 התשובות. **לא** נוצר איש קשר. |
| אחרי הטופס | `lead` | נוצר או מתעדכן `contact`, והמילוי מקושר אליו. |
| בלחיצה על קביעת פגישה | `booking_click` | מסומן `booking_clicked_at`. |

כולן חולקות `session_id` שנוצר בדפדפן בתחילת המילוי, וממוזגות לשורה אחת.
ה-`kind` רק עולה בדרגה — מי שכבר יצא לקבוע פגישה לא חוזר להיות אנונימי.

### התאמה לאיש קשר

לפי טלפון (מנורמל ל-`05XXXXXXXX`, השדה ייחודי בסכימה) ואז לפי אימייל. איש קשר
חדש נוצר עם `source = "שאלון צ'אקרות"` ותגיות `שאלון צ'אקרות` + `חסומה: <שם המרכז>`.
**ה-`status` של איש קשר קיים לא נדרס** — זה שדה שהצוות מנהל ידנית.

כל מעבר שלב נרשם ב-`interactions` עם הסוג `quiz_submitted`, כך שהוא מופיע ביומן
של איש הקשר לצד וואטסאפ ומיילים.

### צפייה בתוצאות

בדף איש הקשר (`/contacts/[id]`) מופיע בלוק עם התוצאה המלאה: גרף הקו של שבעת
המרכזים, דמות המדיטציה עם המרכז החסום מסומן, שבעת הציונים, וכל ההיגדים עם
התשובה שנבחרה. אם אדם מילא יותר מפעם אחת — כל המילויים מוצגים, החדש קודם.

### אבטחה

ה-endpoint ציבורי מעצם טבעו: הוא נקרא מדפדפן של גולש אנונימי, ולכן כל מפתח
שנשתול ב-HTML גלוי בקוד המקור. ההגנה היא ולידציה קפדנית ב-`src/lib/quiz.ts`
(zod, עם תקרות על כל שדה) והעובדה שהוא כותב בלבד ולא מחזיר מידע.
`QUIZ_WEBHOOK_SECRET` מרתיע סורקים אוטומטיים — הוא אינו אבטחה אמיתית.
אם הדף ייחשף לתנועה גבוהה, כדאי להוסיף rate limiting.
