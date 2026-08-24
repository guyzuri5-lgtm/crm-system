import "server-only";

// ManyChat API client. Verified live against a real account 2026-08-24 (endpoint
// paths/request shapes pulled from https://api.manychat.com/swagger/compileJson —
// the rendered /swagger page is a JS app WebFetch can't read, but that JSON endpoint
// behind it is the actual OpenAPI spec and answers definitively).
//
// Three things worth knowing:
//   1. "External Request" (ManyChat → us) is a PRO-plan Flow Builder feature. This is
//      almost certainly what spec section 7 means by "make sure your account supports
//      outgoing API calls" — check the ManyChat plan, not just that an API key exists.
//   2. There is no ManyChat endpoint that sends an approved WhatsApp template message
//      directly by template name. You build a Flow in the ManyChat UI whose first step
//      is the approved template, then trigger that Flow via sendFlow. That's why
//      message_templates.manychat_template_id must hold a Flow namespace (flow_ns),
//      not a Meta template name — see the column comment in the migration.
//   3. /fb/sending/sendContent — the obvious way to send free-typed WhatsApp text —
//      is broken/deprecated for WhatsApp. Confirmed live: rejected with error 3011
//      even for a subscriber who had messaged seconds earlier, and multiple ManyChat
//      community threads report the same. Free-typed replies go through sendFlow +
//      a custom field instead — see sendDynamicReply's doc comment below.

const MANYCHAT_API_BASE = "https://api.manychat.com";

export class ManyChatApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown
  ) {
    super(message);
    this.name = "ManyChatApiError";
  }
}

function apiToken(): string {
  const token = process.env.MANYCHAT_API_TOKEN;
  if (!token) {
    throw new Error(
      "MANYCHAT_API_TOKEN is not set — get it from ManyChat Settings → API and add it to .env.local / your Vercel project env vars."
    );
  }
  return token;
}

async function manychatFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${MANYCHAT_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ManyChatApiError(
      `ManyChat API ${path} returned ${res.status}`,
      res.status,
      payload
    );
  }

  return payload;
}

/**
 * Trigger a ManyChat Flow by namespace. Used both for approved WhatsApp templates
 * (outside the 24h window) and, via sendDynamicReply below, for free-typed replies
 * inside it — WhatsApp sends on ManyChat go through a Flow either way.
 */
export async function sendFlow(subscriberId: string, flowNs: string) {
  return manychatFetch("/fb/sending/sendFlow", {
    subscriber_id: subscriberId,
    flow_ns: flowNs,
  });
}

/**
 * Set a subscriber's custom field by its (not case-sensitive) name — confirmed
 * against the real API 2026-08-24: POST /fb/subscriber/setCustomFieldByName,
 * body {subscriber_id: number, field_name: string, field_value}.
 */
export async function setCustomFieldByName(
  subscriberId: string,
  fieldName: string,
  value: string
) {
  return manychatFetch("/fb/subscriber/setCustomFieldByName", {
    subscriber_id: Number(subscriberId),
    field_name: fieldName,
    field_value: value,
  });
}

/**
 * The custom field a one-time "reply relay" Flow reads from — see
 * sendDynamicReply's doc comment. Must match the field created via
 * POST /fb/page/createCustomField exactly (case-insensitive).
 */
export const REPLY_RELAY_FIELD_NAME = "CRM Reply Text";

/**
 * Sends free-typed text (not a pre-built template) to a subscriber INSIDE the 24h
 * window.
 *
 * Why this isn't a simple "send this text" call: ManyChat's own /fb/sending/sendContent
 * endpoint — the obvious choice — turns out to be broken/deprecated for WhatsApp.
 * Confirmed live against this account 2026-08-24: it returned error code 3011
 * ("...without a message tag...") even for a subscriber who had messaged
 * seconds earlier, and multiple ManyChat community threads report the same for
 * other accounts. ManyChat support's own fix in those threads: don't use
 * sendContent for WhatsApp at all — use sendFlow.
 *
 * sendFlow can't carry arbitrary text directly (its body is just
 * {subscriber_id, flow_ns}), so dynamic replies use the two-step pattern ManyChat's
 * community documents for this: (1) write the text into a custom field via
 * setCustomFieldByName, (2) trigger a Flow whose only step sends that field's value
 * as a WhatsApp text message.
 *
 * The custom field (REPLY_RELAY_FIELD_NAME, "CRM Reply Text") was created via the
 * API and already exists on this account. The Flow itself can't be created via API
 * — ManyChat has no flow-authoring endpoint — so it's a one-time manual step: build
 * a Flow in the ManyChat UI with a single WhatsApp message step containing just the
 * {{CRM Reply Text}} field tag, then put its flow_ns in MANYCHAT_REPLY_FLOW_NS.
 */
export async function sendDynamicReply(subscriberId: string, text: string) {
  const flowNs = process.env.MANYCHAT_REPLY_FLOW_NS;
  if (!flowNs) {
    throw new Error(
      "MANYCHAT_REPLY_FLOW_NS לא מוגדר — צריך ליצור פעם אחת פלואו ב-ManyChat עם שדה {{CRM Reply Text}} ולשים את ה-flow_ns שלו במשתני הסביבה (ר' README)."
    );
  }
  await setCustomFieldByName(subscriberId, REPLY_RELAY_FIELD_NAME, text);
  return sendFlow(subscriberId, flowNs);
}

/** WhatsApp's business-initiated messaging window is 24 hours from the last message
 * the *contact* sent in. */
const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithin24HourWindow(
  lastIncomingMessageAt: string | null,
  now: Date = new Date()
): boolean {
  if (!lastIncomingMessageAt) return false;
  return now.getTime() - new Date(lastIncomingMessageAt).getTime() < WHATSAPP_WINDOW_MS;
}

/**
 * Shape we expect the ManyChat "External Request" Flow action to POST to
 * /api/webhooks/manychat. ManyChat's Flow Builder can attach the subscriber's full
 * data automatically ("Add Full Subscriber Data" button in the Edit Request screen) —
 * this is the standard ManyChat subscriber object, matching what their own
 * `getInfo` API returns. Field presence can vary by channel (WhatsApp vs
 * Messenger/Instagram) and by ManyChat account, so every field here is optional and
 * parsing is defensive. Confirm the exact shape by logging one real payload once you
 * have ManyChat access, then tighten this type.
 */
export interface ManyChatSubscriberPayload {
  id?: string | number;
  subscriber_id?: string | number;
  first_name?: string;
  last_name?: string;
  name?: string;
  phone?: string;
  whatsapp_phone?: string;
  optin_phone?: string;
  last_input_text?: string;
  last_interaction?: string;
  // Confirmed against a real "Add Full Contact Data" payload (2026-08-24): contacts
  // that came in through a channel other than WhatsApp (e.g. Instagram) have
  // whatsapp_phone: null, but this account keeps a phone number in a custom field
  // named "טלפון" for those. Field *names* here are per-account, not a ManyChat
  // standard — if a different account's custom field is named differently, add it to
  // PHONE_CUSTOM_FIELD_KEYS below.
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ParsedManyChatContact {
  subscriberId: string;
  fullName: string | null;
  phone: string | null;
  lastMessageText: string | null;
  /** ISO timestamp, if ManyChat included one; otherwise we fall back to "now" at the call site. */
  lastInteractionAt: string | null;
}

// Custom field names known to hold a phone number, tried in order if the native
// whatsapp_phone/phone fields are empty (common for contacts that opted in through a
// non-WhatsApp channel). "טלפון" confirmed against this account's real data; the
// English variants are a defensive guess for other accounts.
const PHONE_CUSTOM_FIELD_KEYS = ["טלפון", "phone", "Phone"];

function phoneFromCustomFields(customFields: Record<string, unknown> | undefined): string | null {
  if (!customFields) return null;
  for (const key of PHONE_CUSTOM_FIELD_KEYS) {
    const value = customFields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function parseManyChatSubscriber(
  payload: ManyChatSubscriberPayload
): ParsedManyChatContact {
  const subscriberId = String(payload.subscriber_id ?? payload.id ?? "");
  if (!subscriberId) {
    throw new Error(
      "ManyChat webhook payload has no subscriber id — check the External Request body configuration in the ManyChat Flow."
    );
  }

  const fullName =
    payload.name ??
    [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim() ??
    null;

  const phone =
    payload.whatsapp_phone ??
    payload.optin_phone ??
    payload.phone ??
    phoneFromCustomFields(payload.custom_fields) ??
    null;

  return {
    subscriberId,
    fullName: fullName || null,
    phone: phone || null,
    lastMessageText: payload.last_input_text ?? null,
    lastInteractionAt: payload.last_interaction ?? null,
  };
}
