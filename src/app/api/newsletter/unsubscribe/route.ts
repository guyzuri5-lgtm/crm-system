import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/newsletter";

/**
 * GET /api/newsletter/unsubscribe?c=<contact>&t=<token>
 *
 * ציבורי לגמרי — הקישור נלחץ מתוך תיבת דואר, בלי סשן. מה שמחליף אימות הוא
 * החתימה: בלי הסוד אי אפשר לייצר קישור תקף למזהה שלא נשלח אליו.
 *
 * ההסרה חלה על **ניוזלטרים בלבד**. מסעות, כללים, תזכורות פגישה והודעות
 * ידניות ממשיכים כרגיל — מי שביקש לא לקבל דיוור לא ביקש לנתק את הקשר.
 */
export const dynamic = "force-dynamic";

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Rubik,Arial,sans-serif;color:#1c1a17;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:64px 16px;">
<div style="max-width:460px;background:#ffffff;border:1px solid #e7e2dc;border-radius:16px;padding:32px;text-align:center;">
<h1 style="margin:0 0 12px;font-size:20px;font-weight:600;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:1.7;color:#6b6459;">${body}</p>
</div>
</td></tr>
</table>
</body>
</html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: NextRequest) {
  const contactId = request.nextUrl.searchParams.get("c") ?? "";
  const token = request.nextUrl.searchParams.get("t") ?? "";

  // הודעה אחת לכל כשל, בלי לרמוז מה בדיוק לא התאים: קישור שגוי לא אמור
  // לספר למי שמנחש אם המזהה קיים.
  const reject = () =>
    page("הקישור אינו תקין", "הקישור פג או שאינו שלם. אפשר להשיב למייל ונטפל בזה ידנית.", 400);

  if (!contactId || !token) return reject();

  let valid = false;
  try {
    valid = verifyUnsubscribeToken(contactId, token);
  } catch {
    // NEWSLETTER_UNSUB_SECRET חסר. אותה תשובה כלפי חוץ, ורישום בלוג כדי
    // שמי שמתחזק יראה שזו תקלת הגדרה ולא קישור מזויף.
    console.error("[newsletter] unsubscribe verification failed — is NEWSLETTER_UNSUB_SECRET set?");
    return reject();
  }
  if (!valid) return reject();

  const { error } = await supabaseAdmin()
    .from("contacts")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", contactId);

  if (error) {
    console.error("[newsletter] failed to record unsubscribe:", error.message);
    return page(
      "לא הצלחנו לעדכן כרגע",
      "משהו השתבש אצלנו. אפשר לנסות שוב בעוד רגע, או להשיב למייל ונטפל בזה ידנית.",
      500
    );
  }

  return page(
    "הוסרת מרשימת התפוצה",
    "תמשיכי לקבל רק הודעות אישיות ותפעוליות.",
    200
  );
}
