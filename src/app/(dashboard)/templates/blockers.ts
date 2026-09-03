import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * מי מחזיק בתבנית ומונע את מחיקתה.
 *
 * שני מפתחות זרים מצביעים על message_templates ושניהם ON DELETE RESTRICT
 * בכוונה (0001_init.sql, 0016_journeys.sql): מסע או כלל שאיבד את התבנית שלו
 * היה נשאר עם שלב בלי תוכן, ותקלה כזו מתגלה רק כשהקרון מגיע לשלוח — כלומר
 * על לקוח אמיתי, ובשקט.
 *
 * המחסום עצמו נכון. מה שחסר היה לומר *מי* חוסם: Postgres מחזיר קוד 23503
 * ותו לא, ולכן ההודעה שנבנתה ממנו יכלה רק לנחש. כאן נשאלים המקורות עצמם,
 * וכל מחזיק מוחזר כביטוי מוכן לתצוגה ("המסע ...", "כלל האוטומציה ...").
 */
export async function listTemplateBlockers(): Promise<Map<string, string[]>> {
  const db = supabaseAdmin();

  const [
    { data: steps, error: stepsError },
    { data: journeys, error: journeysError },
    { data: rules, error: rulesError },
  ] = await Promise.all([
    db.from("journey_steps").select("template_id, journey_id"),
    db.from("journeys").select("id, name"),
    db.from("automation_rules").select("action_template_id, trigger_type"),
  ]);
  if (stepsError) throw stepsError;
  if (journeysError) throw journeysError;
  if (rulesError) throw rulesError;

  const journeyName = new Map((journeys ?? []).map((j) => [j.id, j.name]));
  const blockers = new Map<string, string[]>();

  // אותה תבנית יכולה להופיע בכמה שלבים של אותו מסע. לרשימה שנועדה להסביר
  // לאן ללכת, "המסע X" פעמיים אינו מידע נוסף.
  const add = (templateId: string, holder: string) => {
    const existing = blockers.get(templateId);
    if (!existing) blockers.set(templateId, [holder]);
    else if (!existing.includes(holder)) existing.push(holder);
  };

  for (const step of steps ?? []) {
    add(step.template_id, `המסע "${journeyName.get(step.journey_id) ?? "ללא שם"}"`);
  }
  for (const rule of rules ?? []) {
    add(
      rule.action_template_id,
      `כלל האוטומציה "${rule.trigger_type === "status_change" ? "שינוי סטטוס" : "זמן ללא מענה"}"`
    );
  }

  return blockers;
}

/** המשפט שמוצג למשתמש. אותו נוסח בכרטיס ובהודעה שאחרי ניסיון מחיקה. */
export function blockedExplanation(templateName: string, holders: string[]): string {
  return `אי אפשר למחוק את התבנית "${templateName}" — היא עדיין בשימוש: ${holders.join(", ")}.`;
}
