import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseManyChatSubscriber, type ManyChatSubscriberPayload } from "@/lib/manychat";

// POST /api/webhooks/manychat — per spec section 4.
//
// This is NOT called automatically just because a ManyChat account exists. You must
// build a Flow in the ManyChat UI (Automation → e.g. "on new message" trigger) with an
// "External Request" action (Flow Builder → + Action → External Request — a PRO-plan
// feature) that POSTs here. In that action's Request Body, use ManyChat's "Add Full
// Subscriber Data" button so the payload matches what parseManyChatSubscriber below
// expects. Set a custom header `X-Webhook-Secret: <MANYCHAT_WEBHOOK_SECRET>` on the
// External Request so this endpoint can tell a real ManyChat call apart from a random
// POST to a public URL.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (configuredSecret) {
    const provided = request.headers.get("x-webhook-secret");
    if (provided !== configuredSecret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: ManyChatSubscriberPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseManyChatSubscriber(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid payload" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();

  const { data: existing, error: findError } = await db
    .from("contacts")
    .select("*")
    .eq("manychat_subscriber_id", parsed.subscriberId)
    .maybeSingle();
  if (findError) {
    return NextResponse.json({ error: findError.message }, { status: 500 });
  }

  const newInteractionAt = parsed.lastInteractionAt ?? new Date().toISOString();

  // Best-effort dedupe: ManyChat's External Request is a regular webhook and does not
  // promise exactly-once delivery. If it included a last_interaction timestamp that's
  // no newer than what we already have on file, treat this as a re-delivery of an
  // event we've already recorded — update the contact's basic fields (in case a name
  // was missing before) but don't log a second interaction or fire rules again.
  const isDuplicateEvent =
    existing?.last_incoming_message_at != null &&
    parsed.lastInteractionAt != null &&
    new Date(parsed.lastInteractionAt).getTime() <=
      new Date(existing.last_incoming_message_at).getTime();

  const contactFields = {
    manychat_subscriber_id: parsed.subscriberId,
    full_name: parsed.fullName ?? existing?.full_name ?? null,
    phone: parsed.phone ?? existing?.phone ?? null,
    last_incoming_message_at: isDuplicateEvent
      ? (existing?.last_incoming_message_at ?? newInteractionAt)
      : newInteractionAt,
  };

  const { data: contact, error: upsertError } = existing
    ? await db.from("contacts").update(contactFields).eq("id", existing.id).select("*").single()
    : await db
        .from("contacts")
        .insert({ ...contactFields, source: "ManyChat" })
        .select("*")
        .single();

  if (upsertError) {
    // A concurrent request could insert the same phone/subscriber_id between our
    // lookup and this write — the unique constraints on contacts.phone and
    // contacts.manychat_subscriber_id catch that; surface it as 409, not a generic 500.
    const status = upsertError.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: upsertError.message }, { status });
  }

  if (!isDuplicateEvent) {
    const { error: interactionError } = await db.from("interactions").insert({
      contact_id: contact.id,
      type: "manychat_in",
      content: parsed.lastMessageText,
    });
    if (interactionError) {
      return NextResponse.json({ error: interactionError.message }, { status: 500 });
    }
  }

  // No runStatusChangeRules call here on purpose — see that function's doc comment in
  // src/lib/automation-engine.ts. This handler never writes contacts.status.

  return NextResponse.json({ ok: true, contact_id: contact.id, duplicate: isDuplicateEvent });
}
