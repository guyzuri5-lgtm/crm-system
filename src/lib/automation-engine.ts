import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { renderTemplate } from "./templates";
import { sendMessageToContact } from "./send";
import { SendBudget } from "./whatsapp-throttle";
import type {
  AutomationRule,
  Contact,
  ContactStatus,
  MessageTemplate,
  StatusChangeTriggerValue,
  TimeSinceNoReplyTriggerValue,
} from "./supabase/database.types";

// The rules engine described in spec section 5. Two entry points:
//   - runStatusChangeRules(contact, fromStatus)   — call right after a status write
//   - runTimeSinceNoReplyRules()                  — call once a day from the cron route
//
// Both funnel into dispatchRuleToContact, which renders the rule's template and hands
// off to sendMessageToContact (src/lib/send.ts) for the actual channel/send/log work.
// A failure for one contact/rule never throws past its own DispatchResult — one bad
// send (missing email, contact with no usable phone number, no approved template for
// an out-of-window WhatsApp send, ...) must not abort a batch of 50 other contacts in
// the daily cron run.

export interface DispatchResult {
  ruleId: string;
  contactId: string;
  ok: boolean;
  error?: string;
}

type RuleWithTemplate = AutomationRule & { message_templates: MessageTemplate | null };

async function dispatchRuleToContact(
  rule: AutomationRule,
  template: MessageTemplate,
  contact: Contact
): Promise<DispatchResult> {
  const body = renderTemplate(template.body, contact);
  const subject =
    rule.action_channel === "email"
      ? renderTemplate(template.subject ?? template.name, contact)
      : undefined;

  const result = await sendMessageToContact({
    contact,
    channel: rule.action_channel,
    subject,
    body,
    // כלל מעקב פונה מעצם טבעו למי שלא ענה, כלומר כמעט תמיד מחוץ לחלון 24
    // השעות. בלי תבנית מאושרת על התבנית של הכלל, השליחה תיכשל — וזה הדבר
    // הנכון: עדיף כישלון מפורש מאשר הודעה שלא יוצאת בשקט.
    template,
    logPrefix: `[${template.name}]`,
  });

  return { ruleId: rule.id, contactId: contact.id, ...result };
}

/**
 * Fires every active status_change rule whose `from_status` matches the status the
 * contact just left (or every such rule if `from_status` is omitted — "any status").
 * Call this from wherever a contact's status is actually written — today that's only
 * updateContactStatus below. The WhatsApp webhook does NOT call this: it never writes
 * `status` itself (a new contact is just created at the default 'ליד_חדש'), so there
 * is no transition to react to there yet. If you later want e.g. "auto-promote
 * brand-new leads on their first reply," make that status write in the webhook route
 * and call this function with the old/new status afterwards.
 */
export async function runStatusChangeRules(
  contact: Contact,
  fromStatus: ContactStatus | null
): Promise<DispatchResult[]> {
  const db = supabaseAdmin();

  const { data: rules, error } = await db
    .from("automation_rules")
    .select("*, message_templates(*)")
    .eq("trigger_type", "status_change")
    .eq("active", true)
    .returns<RuleWithTemplate[]>();

  if (error) throw error;
  if (!rules?.length) return [];

  const results: DispatchResult[] = [];
  for (const rule of rules) {
    const triggerValue = (rule.trigger_value ?? {}) as StatusChangeTriggerValue;
    const matches = !triggerValue.from_status || triggerValue.from_status === fromStatus;
    if (!matches || !rule.message_templates) continue;
    results.push(await dispatchRuleToContact(rule, rule.message_templates, contact));
  }
  return results;
}

/**
 * Updates a contact's status and fires matching status_change rules. The one place in
 * this codebase that writes contacts.status — both the dashboard Server Action and
 * PATCH /api/contacts/[id] call through here so the automation behaviour is identical
 * no matter which path made the change.
 */
export async function updateContactStatus(contactId: string, newStatus: ContactStatus) {
  const db = supabaseAdmin();

  const { data: existing, error: fetchError } = await db
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .single();
  if (fetchError) throw fetchError;

  const fromStatus = existing.status;

  const { data: updated, error: updateError } = await db
    .from("contacts")
    .update({ status: newStatus })
    .eq("id", contactId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  const dispatchResults =
    fromStatus === newStatus ? [] : await runStatusChangeRules(updated, fromStatus);

  return { contact: updated, dispatchResults };
}

export interface RuleRunSummary {
  results: DispatchResult[];
  /** למה הריצה נעצרה, אם היא לא סיימה את כל מי שהיה מועמד */
  stopped: "paused" | "daily_limit" | "time_budget" | null;
  /** כמה אנשי קשר נשארו מחוץ לריצה הזו ויטופלו בריצה הבאה */
  skipped: number;
  /** כמה עוד מותר לשלוח היום לפי התקרה */
  remainingToday: number;
}

/**
 * Meant to run once a day (see /api/cron/check-rules). For every active
 * time_since_no_reply rule, finds contacts sitting in the rule's target status that
 * have been quiet for at least `days`, skips any this exact rule already fired for
 * (automation_rule_runs), sends, and records the run.
 *
 * Contacts that have NEVER sent an incoming message (last_incoming_message_at is
 * null) are measured from created_at instead — the original spec doesn't pin this
 * down explicitly; adjust here if that's not the intended behaviour.
 *
 * ── בלמים ────────────────────────────────────────────────────────────────
 * שליחות וואטסאפ עוברות דרך SendBudget (src/lib/whatsapp-throttle.ts): תקרה
 * יומית ותקציב זמן ריצה. כשאחד מהם נגמר הריצה נעצרת *מרצון* ומדווחת כמה נשארו.
 * התקרה כאן היא בלם עלות — כל תבנית שנמסרת מחויבת על ידי Meta.
 *
 * מה שהופך את העצירה הזו לבטוחה הוא automation_rule_runs: שורה נרשמת שם רק
 * אחרי שליחה מוצלחת, ולכן מי שלא הספיק פשוט יימצא שוב בריצה הבאה. אין כאן
 * "מצב" לשמור ואין סיכון לשליחה כפולה.
 *
 * שליחות מייל אינן מווסתות — Gmail אינו חוסם על קצב כמו שוואטסאפ חוסם, והמכסה
 * היומית שלו גבוהה בסדרי גודל.
 */
export async function runTimeSinceNoReplyRules(
  now: Date = new Date(),
  budgetMs = 45_000
): Promise<RuleRunSummary> {
  const db = supabaseAdmin();
  const budget = await SendBudget.open(budgetMs, now);

  const { data: rules, error } = await db
    .from("automation_rules")
    .select("*, message_templates(*)")
    .eq("trigger_type", "time_since_no_reply")
    .eq("active", true)
    .returns<RuleWithTemplate[]>();

  if (error) throw error;
  if (!rules?.length) {
    return { results: [], stopped: null, skipped: 0, remainingToday: budget.remainingToday };
  }

  const results: DispatchResult[] = [];
  let stopped: RuleRunSummary["stopped"] = null;
  let skipped = 0;

  for (const rule of rules) {
    const triggerValue = (rule.trigger_value ?? {}) as Partial<TimeSinceNoReplyTriggerValue>;
    if (!rule.message_templates || !triggerValue.days || !triggerValue.status) continue;

    const cutoffIso = new Date(now.getTime() - triggerValue.days * 24 * 60 * 60 * 1000).toISOString();

    const { data: staleContacts, error: contactsError } = await db
      .from("contacts")
      .select("*")
      .eq("status", triggerValue.status)
      .or(
        `last_incoming_message_at.lte.${cutoffIso},and(last_incoming_message_at.is.null,created_at.lte.${cutoffIso})`
      );
    if (contactsError) throw contactsError;
    if (!staleContacts?.length) continue;

    const { data: alreadyRun, error: alreadyRunError } = await db
      .from("automation_rule_runs")
      .select("contact_id")
      .eq("rule_id", rule.id)
      .in(
        "contact_id",
        staleContacts.map((c) => c.id)
      );
    if (alreadyRunError) throw alreadyRunError;

    const alreadyRunIds = new Set((alreadyRun ?? []).map((r) => r.contact_id));

    const throttled = rule.action_channel === "whatsapp";

    for (const contact of staleContacts) {
      if (alreadyRunIds.has(contact.id)) continue;

      // הבדיקה חלה על **כל** ערוץ, ו-SendBudget יודע בעצמו מה חל על מה:
      // ההשהיה ותקציב הזמן על שניהם, התקרה היומית על וואטסאפ בלבד.
      //
      // קודם היא הייתה עטופה ב-if (throttled), כלומר כלל מייל לא עבר דרך שום
      // בלם: מתג ההשהיה לא עצר אותו — בניגוד למה שהמתג מבטיח למי שלוחץ עליו —
      // ולא היה לו תקציב זמן, כך שכלל שהתאים למאות אנשי קשר ניסה לשלוח לכולם
      // בריצה אחת ונקטע באמצע.
      //
      // לא break: כלל אחר באותה ריצה עשוי להיות כלל מייל, ואין סיבה לעצור
      // אותו בגלל תקרת הוואטסאפ שנגמרה.
      const allowed = budget.canSend(rule.action_channel);
      if (!allowed.ok) {
        stopped ??= allowed.reason;
        skipped += 1;
        continue;
      }

      const result = await dispatchRuleToContact(rule, rule.message_templates, contact);
      results.push(result);

      if (result.ok) {
        if (throttled) budget.countSent();

        const { error: runError } = await db
          .from("automation_rule_runs")
          .insert({ rule_id: rule.id, contact_id: contact.id });
        if (runError) throw runError;
      }
    }
  }

  return { results, stopped, skipped, remainingToday: budget.remainingToday };
}
