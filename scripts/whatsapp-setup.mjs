#!/usr/bin/env node
/**
 * הכנסת מפתחות WhatsApp Cloud API ל-.env.local, ואימות מיידי שהם עובדים.
 *
 *   npm run setup:whatsapp
 *
 * למה סקריפט ולא עריכה ידנית של הקובץ: שלושה מהערכים האלה הם סוד. הסקריפט
 * קורא אותם ישירות מהמקלדת בלי להדפיס אותם למסך, כותב אותם לקובץ, ולא משאיר
 * אותם בהיסטוריית הטרמינל — בניגוד להדבקה בתוך פקודה, ששומרת את הטוקן בטקסט
 * גלוי בתוך ‎~/.zsh_history‎.
 *
 * מיד אחרי הכתיבה הוא שולף את מצב המספר מ-Meta, כדי שהתשובה לשאלה "הכנסתי
 * נכון?" תגיע תוך שנייה ולא בפעם הראשונה שמישהו ינסה לשלוח הודעה.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";

const ENV_PATH = ".env.local";
const DEFAULT_API_VERSION = "v21.0";

const CLEAR_LINE = "\u001b[2K";
const LINE_START = "\u001b[200D";

/**
 * קריאת שורה מהמקלדת בלי להציג אותה.
 *
 * readline רגיל מהדהד כל תו, ולכן הטוקן היה נשאר על המסך — ובצילום מסך, ובעיניו
 * של כל מי שעומד מאחור. ה-listener מוחק את השורה בכל הקשה ומצייר אותה מחדש
 * בכוכביות, כך שנשאר משוב על ההקלדה בלי לחשוף את התוכן.
 */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });

    const onData = (chunk) => {
      const char = chunk.toString();
      if (char === "\n" || char === "\r" || char === "\u0004" || char === "\u0003") {
        stdin.removeListener("data", onData);
        return;
      }
      stdout.write(CLEAR_LINE + LINE_START + prompt + "*".repeat(rl.line.length));
    };

    stdout.write(prompt);
    stdin.on("data", onData);

    rl.question("", (answer) => {
      stdin.removeListener("data", onData);
      rl.close();
      stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function readEnvFile() {
  if (!existsSync(ENV_PATH)) {
    console.error(`✗ ${ENV_PATH} לא נמצא. הריצו את הסקריפט מתיקיית השורש של הפרויקט.`);
    process.exit(1);
  }
  return readFileSync(ENV_PATH, "utf8");
}

/**
 * עדכון מפתח תוך שמירה על כל השאר.
 *
 * החלפת שורה קיימת ולא הוספה בסוף: מפתח שמופיע פעמיים באותו קובץ הוא בדיוק
 * סוג התקלה שקשה לאתר, כי הערך שגובר תלוי בסדר הקריאה.
 */
function upsert(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

function parseEnv(content) {
  const env = {};
  for (const line of content.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const QUALITY_LABELS = {
  GREEN: "✓ איכות המספר: תקינה",
  YELLOW: "⚠ איכות המספר: יורדת — הצטברו תלונות מנמענים",
  RED: "✗ איכות המספר: נמוכה — Meta עלולה להגביל את המספר",
};

async function verify(env) {
  const version = env.WHATSAPP_API_VERSION || DEFAULT_API_VERSION;
  const fields = "display_phone_number,verified_name,quality_rating,messaging_limit_tier";
  const response = await fetch(
    `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=${fields}`,
    { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // הטוקן עצמו לא מודפס בשום מצב — רק ההסבר ש-Meta מחזירה
    throw new Error(body?.error?.message ?? `Meta החזירה ${response.status}`);
  }
  return body;
}

async function main() {
  console.log("\n== WhatsApp Cloud API setup ==\n");
  console.log("  הערכים נמצאים ב-developers.facebook.com, באפליקציה שלכם.");
  console.log("  ההקלדה מוסתרת בכוונה. הדביקו ולחצו Enter גם אם לא רואים כלום.\n");

  console.log("  [1/3] WhatsApp -> API Setup -> Phone number ID");
  console.log("        (מזהה, לא מספר הטלפון. ספרות בלבד)");
  const phoneNumberId = await askHidden("        Phone number ID: ");
  if (!/^\d{6,}$/.test(phoneNumberId)) {
    console.error("\n  שגיאה: Phone number ID אמור להיות ספרות בלבד.");
    console.error("  לא נכתב כלום. הריצו שוב: npm run setup:whatsapp\n");
    process.exit(1);
  }

  console.log("\n  [2/3] Access token");
  console.log("        לפרודקשן: System User token ללא תפוגה.");
  console.log("        הטוקן שבדף API Setup פג אחרי 24 שעות.");
  const accessToken = await askHidden("        Access token: ");
  if (accessToken.length < 40) {
    console.error(`\n  שגיאה: התקבלו ${accessToken.length} תווים — קצר מדי לטוקן.`);
    console.error("  לא נכתב כלום. הריצו שוב: npm run setup:whatsapp\n");
    process.exit(1);
  }

  console.log("\n  [3/3] App Settings -> Basic -> App Secret");
  console.log("        (חותם את ה-webhooks. בלעדיו הראוט דוחה הכול)");
  const appSecret = await askHidden("        App Secret: ");
  if (!/^[a-f0-9]{20,}$/i.test(appSecret)) {
    console.error("\n  שגיאה: App Secret אמור להיות מחרוזת של ספרות ואותיות a-f.");
    console.error("  לא נכתב כלום. הריצו שוב: npm run setup:whatsapp\n");
    process.exit(1);
  }

  let content = readEnvFile();
  content = upsert(content, "WHATSAPP_PHONE_NUMBER_ID", phoneNumberId);
  content = upsert(content, "WHATSAPP_ACCESS_TOKEN", accessToken);
  content = upsert(content, "WHATSAPP_APP_SECRET", appSecret);

  // טוקן האימות של ה-webhook נוצר כאן אם עוד אין: הוא סוד שנולד אצלנו ולא
  // מגיע מבחוץ, ואין סיבה לבקש ממישהו להמציא מחרוזת אקראית בעצמו.
  const existing = parseEnv(content);
  const needsVerifyToken = !existing.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (needsVerifyToken) {
    content = upsert(content, "WHATSAPP_WEBHOOK_VERIFY_TOKEN", randomBytes(24).toString("hex"));
  }

  writeFileSync(ENV_PATH, content);
  console.log(`\n✓ נכתב ל-${ENV_PATH}`);
  if (needsVerifyToken) console.log("✓ נוצר WHATSAPP_WEBHOOK_VERIFY_TOKEN חדש");

  console.log("\n== בדיקת חיבור ==\n");
  try {
    const info = await verify(parseEnv(content));
    console.log(`  ✓ המפתחות תקפים`);
    if (info.display_phone_number) console.log(`    מספר:  ${info.display_phone_number}`);
    if (info.verified_name) console.log(`    שם:    ${info.verified_name}`);
    if (info.quality_rating) {
      console.log(`    ${QUALITY_LABELS[info.quality_rating] ?? `דירוג: ${info.quality_rating}`}`);
    }
    if (info.messaging_limit_tier) {
      console.log(`    תקרה:  ${String(info.messaging_limit_tier).replace("TIER_", "")} ליום`);
    }
  } catch (error) {
    console.log(`  ✗ ${error.message}`);
    console.log("\n  הערכים נשמרו בכל זאת. בדקו אותם ב-Meta והריצו שוב אם צריך.");
    process.exit(1);
  }

  console.log("\n  להצגת טוקן האימות (להדבקה ב-Verify token בהגדרות ה-webhook):");
  console.log("    grep WHATSAPP_WEBHOOK_VERIFY_TOKEN .env.local\n");
}

main().catch((error) => {
  console.error("\n✗ " + (error?.message ?? error));
  process.exit(1);
});
