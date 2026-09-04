"use server";

import { revalidatePath } from "next/cache";
import { toResult, type ActionResult } from "@/lib/action-result";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { assertInboxMigrated, markFailed, markProcessed } from "@/lib/webhook-inbox";
import { parseLeadgenEvents, processLeadgenEvent, type MetaLeadsWebhook } from "@/lib/meta-leads";
import { extractPayer, settlePayment } from "@/lib/grow";
import { META_FORM_TARGET_TYPES, type MetaFormTargetType } from "@/lib/supabase/database.types";

// ניהול טבלת meta_form_targets ותיבת ה-webhooks (0030).

function revalidateAll() {
  revalidatePath("/settings/meta-forms");
  // ליד שעובד מחדש יוצר מתעניינת חדשה, וזו מופיעה בשני המסכים האלה.
  revalidatePath("/events");
  revalidatePath("/courses");
}

/**
 * היעד מגיע כערך אחד ("event:<uuid>") ולא כשני שדות.
 *
 * שדה אחד ולא שניים כי הם אינם עצמאיים: סוג בלי מזהה, או מזהה של אירוע עם
 * סוג "קורס", הם צירופים שאין להם משמעות. רשימה נפתחת אחת שמכילה את כל
 * האירועים ואת כל הקורסים לא יכולה לייצר אותם מלכתחילה.
 */
function readTarget(formData: FormData): { type: MetaFormTargetType; id: string } {
  const raw = String(formData.get("target") ?? "");
  const separator = raw.indexOf(":");
  const type = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!(META_FORM_TARGET_TYPES as readonly string[]).includes(type) || !id) {
    throw new Error("צריך לבחור אירוע או קורס");
  }
  return { type: type as MetaFormTargetType, id };
}

/**
 * שמירת שיוך. אותה פעולה למקרה חדש ולעריכה — form_id הוא המפתח הראשי, ולכן
 * upsert מבטא בדיוק את הכוונה: "מעכשיו הטופס הזה מפנה לשם".
 */
export async function saveFormTargetAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    // מטא שולחת את המזהה כמספר ארוך. ניקוי רווחים ותווים שאינם ספרות מונע את
    // התקלה השקטה של הדבקה מהממשק שלה, שגוררת איתה רווח או תו כיווניות.
    const formId = String(formData.get("form_id") ?? "").replace(/[^\d]/g, "");
    if (!formId) throw new Error("צריך למלא את מזהה הטופס (מספר בלבד)");

    const target = readTarget(formData);
    const label = String(formData.get("label") ?? "").trim().slice(0, 120) || null;

    const { error } = await supabaseAdmin()
      .from("meta_form_targets")
      .upsert(
        { form_id: formId, target_type: target.type, target_id: target.id, label },
        { onConflict: "form_id" }
      );
    assertInboxMigrated(error);
    if (error) throw new Error(error.message);

    revalidateAll();
  });
}

export async function deleteFormTargetAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const formId = String(formData.get("form_id") ?? "");
    if (!formId) throw new Error("חסר מזהה טופס");

    const { error } = await supabaseAdmin().from("meta_form_targets").delete().eq("form_id", formId);
    if (error) throw new Error(error.message);

    revalidateAll();
  });
}

/**
 * ניסיון עיבוד חוזר של שורה שנתקעה.
 *
 * זה מה שהופך את ההתראה בתחתית המסך לניתנת לסגירה: מי שהגיע לכאן כי ליד לא
 * שויך, משייך את הטופס למעלה ואז לוחץ כאן — והלקוחה נכנסת למערכת. בלי זה
 * התיקון היה חלקי: הלידים הבאים היו נקלטים, ומי שכבר הגיעה הייתה נשארת
 * בתיבה כ-JSON שצריך להקליד ידנית.
 *
 * ה-payload נקרא מהתיבה ועובר באותו מסלול בדיוק כמו webhook חי — אין כאן
 * מסלול עיבוד שני שיכול להיפרד מהראשון.
 */
export async function reprocessInboxAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    if (!id) throw new Error("חסר מזהה שורה");

    const { data: row, error } = await supabaseAdmin()
      .from("webhook_inbox")
      .select("id, source, payload")
      .eq("id", id)
      .maybeSingle();
    assertInboxMigrated(error);
    if (error) throw new Error(error.message);
    if (!row) throw new Error("השורה לא נמצאה");

    try {
      if (row.source === "meta") {
        const events = parseLeadgenEvents(row.payload as MetaLeadsWebhook);
        if (events.length === 0) throw new Error("אין ב-payload ליד לעבד");
        for (const event of events) await processLeadgenEvent(event);
      } else if (row.source === "grow") {
        await settlePayment(extractPayer(row.payload));
      } else {
        throw new Error(`מקור לא מוכר: ${row.source}`);
      }
    } catch (err) {
      // הסיבה נשמרת בשורה *וגם* מוחזרת למסך: השורה נשארת פתוחה עם ההסבר
      // המעודכן, והמשתמש רואה מיד למה הלחיצה לא הועילה.
      const reason = err instanceof Error ? err.message : String(err);
      await markFailed(id, reason);
      revalidateAll();
      throw new Error(reason);
    }

    await markProcessed(id);
    revalidateAll();
  });
}

/**
 * סגירת שורה בלי לעבד אותה — "ראיתי, טיפלתי ידנית".
 *
 * קיים כי לא כל שורה תקועה ניתנת לתיקון: תשלום של לקוחה שנרשמה בטלפון אחר,
 * בדיקה שגיא עשה בעצמו. בלי הכפתור הזה ההתראה הייתה הופכת לרעש קבוע, וכל
 * התראה שאי אפשר לסגור נגמרת באותו מקום — מפסיקים להסתכל בה.
 */
export async function dismissInboxAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await verifyTeamMember();

    const id = String(formData.get("id") ?? "");
    if (!id) throw new Error("חסר מזהה שורה");

    await markProcessed(id);
    revalidateAll();
  });
}
