import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { renderTemplate } from "./templates";
import { sendMessageToContact } from "./send";
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
// send (missing email, contact outside the WhatsApp window with no template
// configured, ...) must not abort a batch of 50 other contacts in the daily cron run.

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
    manychatFlowNs: template.manychat_template_id,
    logPrefix: `[${template.name}]`,
  });

  return { ruleId: rule.id, contactId: contact.id, ...result };
}

/**
 * Fires every active status_change rule whose `from_status` matches the status the
 * contact just left (or every such rule if `from_status` is omitted — "any status").
 * Call this from wherever a contact's status is actually written — today that's only
 * updateContactStatus below. The ManyChat webhook does NOT call this: in this v1 it
 * never writes `status` itself (a new contact is just created at the default
 * 'ליד_חדש'), so there is no transition to react to there yet. If you later want e.g.
 * "auto-promote brand-new leads on their first reply," make that status write in the
 * webhook route and call this function with the old/new status afterwards.
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

/**
 * Meant to run once a day (see /api/cron/check-rules). For every active
 * time_since_no_reply rule, finds contacts sitting in the rule's target status that
 * have been quiet for at least `days`, skips any this exact rule already fired for
 * (automation_rule_runs), sends, and records the run.
 *
 * Contacts that have NEVER sent an incoming message (last_incoming_message_at is
 * null) are measured from created_at instead — the original spec doesn't pin this
 * down explicitly; adjust here if that's not the intended behaviour.
 */
export async function runTimeSinceNoReplyRules(now: Date = new Date()): Promise<DispatchResult[]> {
  const db = supabaseAdmin();

  const { data: rules, error } = await db
    .from("automation_rules")
    .select("*, message_templates(*)")
    .eq("trigger_type", "time_since_no_reply")
    .eq("active", true)
    .returns<RuleWithTemplate[]>();

  if (error) throw error;
  if (!rules?.length) return [];

  const results: DispatchResult[] = [];

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

    for (const contact of staleContacts) {
      if (alreadyRunIds.has(contact.id)) continue;

      const result = await dispatchRuleToContact(rule, rule.message_templates, contact);
      results.push(result);

      if (result.ok) {
        const { error: runError } = await db
          .from("automation_rule_runs")
          .insert({ rule_id: rule.id, contact_id: contact.id });
        if (runError) throw runError;
      }
    }
  }

  return results;
}
