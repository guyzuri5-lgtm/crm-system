#!/usr/bin/env node
/**
 * הפקת GOOGLE_REFRESH_TOKEN עם ההרשאות של שליחת מייל *ושל* היומן, בפעם אחת.
 *
 *   npm run auth:google
 *
 * למה זה כאן ולא הוראות ידניות: הטוקן שהיה במערכת עד היום הופק עם gmail.send
 * בלבד, ומול היומן הוא מחזיר 403. הסקריפט מבקש את שני ה-scopes יחד ומחזיר
 * טוקן אחד שמתאים לשניהם — כך שאין שני טוקנים לתחזק ולא ניתן לשכוח אחד מהם.
 *
 * דרישה חד־פעמית ב-Google Cloud Console:
 *   APIs & Services → Credentials → לחיצה על ה-OAuth client שלכם →
 *   Authorized redirect URIs → הוספת  http://localhost:53682
 * וגם: APIs & Services → Library → הפעלת "Google Calendar API".
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
];

/** קריאת .env.local בלי תלות חיצונית — רק שתי השורות שאנחנו צריכים. */
function readEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // אין .env.local — ניפול חזרה למשתני הסביבה של התהליך.
  }
  return env;
}

const fileEnv = readEnvLocal();
const clientId = process.env.GOOGLE_CLIENT_ID || fileEnv.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET || fileEnv.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "\n✗ חסרים GOOGLE_CLIENT_ID ו/או GOOGLE_CLIENT_SECRET.\n" +
      "  הוסיפו אותם ל-.env.local (ראו .env.example) והריצו שוב.\n"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  // offline הוא מה שגורם לגוגל להחזיר refresh_token בכלל.
  access_type: "offline",
  // consent מפורש: בלעדיו גוגל מחזיר refresh_token רק בפעם הראשונה שאי פעם
  // אישרתם את האפליקציה, וכל הרצה חוזרת הייתה מסתיימת בלי טוקן.
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n─────────────────────────────────────────────────────────────");
console.log("  פתחו את הכתובת הבאה בדפדפן ואשרו את ההרשאות:\n");
console.log(`  ${authUrl}\n`);
console.log("  (יש להתחבר עם חשבון הגוגל שממנו נשלחים המיילים ושבו יושב היומן)");
console.log("─────────────────────────────────────────────────────────────\n");

const server = createServer(async (request, response) => {
  const url = new URL(request.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<div dir="rtl" style="font:16px system-ui;padding:40px">האישור בוטל: ${error}</div>`);
    console.error(`\n✗ האישור בוטל: ${error}\n`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    response.writeHead(400).end("missing code");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<div dir="rtl" style="font:16px system-ui;padding:40px;text-align:center">
         <h2>הצליח ✓</h2><p>אפשר לסגור את החלון ולחזור לטרמינל.</p>
       </div>`
    );

    if (!tokens.refresh_token) {
      console.error(
        "\n✗ גוגל לא החזיר refresh_token.\n" +
          "  זה קורה כשהאפליקציה כבר אושרה בעבר. היכנסו ל-\n" +
          "  https://myaccount.google.com/permissions , הסירו את האפליקציה, והריצו שוב.\n"
      );
      server.close();
      process.exit(1);
    }

    console.log("\n✓ הטוקן הופק. הוסיפו/החליפו ב-.env.local (וגם ב-Environment Variables של Vercel):\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log(`  ה-scopes שאושרו: ${tokens.scope}\n`);
  } catch (err) {
    console.error("\n✗ החלפת הקוד בטוקן נכשלה:", err?.message ?? err, "\n");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`ממתין לאישור על ${REDIRECT_URI} …\n`);
});
