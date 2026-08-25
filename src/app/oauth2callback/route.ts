import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { GMAIL_SEND_SCOPE, GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar";

/**
 * קולט את הקוד שגוגל מחזיר בסוף אישור ההרשאות, ומחליף אותו ב-refresh token.
 *
 * למה כ-route באפליקציה ולא כשרת זמני בסקריפט: כתובת ה-redirect חייבת להיות
 * רשומה מראש ב-Google Cloud Console, ו-`http://localhost:3000/oauth2callback`
 * כבר רשומה שם (היא זו שיושבת ב-GOOGLE_REDIRECT_URI). שימוש בה חוסך שינוי
 * ידני בקונסולה של גוגל.
 *
 * ⚠ פיתוח בלבד. ה-route הזה מחליף קוד הרשאה בטוקן ארוך-טווח וכותב אותו
 * לדיסק — דבר שאסור שיהיה זמין בפרודקשן. הבדיקה למטה חוסמת אותו שם לחלוטין,
 * ובנוסף מערכת הקבצים של Vercel היא לקריאה בלבד ממילא.
 */
export const dynamic = "force-dynamic";

/** הקובץ שאליו נכתב הטוקן. ב-.gitignore — הוא סוד לכל דבר. */
const TOKEN_FILE = ".oauth-token.json";

function page(title: string, body: string, ok: boolean) {
  return new NextResponse(
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
     <title>${title}</title>
     <div style="font:16px/1.7 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;text-align:center">
       <div style="font-size:2.5rem">${ok ? "✓" : "✗"}</div>
       <h1 style="font-size:1.35rem;margin:.5rem 0 1rem">${title}</h1>
       <p style="color:#555">${body}</p>
     </div>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const code = searchParams.get("code");

  if (error) return page("האישור בוטל", `גוגל החזיר: ${error}`, false);
  if (!code) return page("חסר קוד הרשאה", "הכתובת הגיעה בלי פרמטר code.", false);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return page("חסרה הגדרה", "GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI אינם מוגדרים.", false);
  }

  try {
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return page(
        "גוגל לא החזיר refresh token",
        "זה קורה כשהאפליקציה כבר אושרה בעבר. הסירו אותה ב-myaccount.google.com/permissions ונסו שוב.",
        false
      );
    }

    const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
    const hasCalendar = grantedScopes.includes(GOOGLE_CALENDAR_SCOPE);
    const hasGmail = grantedScopes.includes(GMAIL_SEND_SCOPE);

    await writeFile(
      path.join(process.cwd(), TOKEN_FILE),
      JSON.stringify(
        { refresh_token: tokens.refresh_token, scopes: grantedScopes, created_at: new Date().toISOString() },
        null,
        2
      ),
      "utf8"
    );

    if (!hasCalendar || !hasGmail) {
      return page(
        "הטוקן נקלט, אבל חסרות הרשאות",
        `אושרו: ${grantedScopes.join(", ") || "כלום"}. חסר ${!hasCalendar ? "יומן" : "שליחת מייל"}.`,
        false
      );
    }

    return page("הטוקן נקלט", "אפשר לסגור את החלון ולחזור ל-Claude Code.", true);
  } catch (err) {
    return page("החלפת הקוד בטוקן נכשלה", err instanceof Error ? err.message : "שגיאה לא ידועה", false);
  }
}
