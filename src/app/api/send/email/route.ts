import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/templates";
import { sendMessageToContact } from "@/lib/send";

// POST /api/send/email — per spec section 4 ("פנימי: שולח מייל דרך Gmail API"). Used
// for one-off/manual sends from the dashboard (e.g. a "send now" button on a contact
// or template). The automation engine does NOT call this over HTTP — it calls
// sendMessageToContact directly (see src/lib/automation-engine.ts) to avoid a
// pointless self-fetch; this route and the engine both funnel into that same function
// so a manual send and a rule-triggered send behave identically and log the same way.
export const dynamic = "force-dynamic";

const sendEmailSchema = z
  .object({
    contact_id: z.string().uuid(),
    template_id: z.string().uuid().optional(),
    subject: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
  })
  .refine((v) => v.template_id || (v.subject && v.html), {
    message: "provide either template_id, or both subject and html",
  });

export async function POST(request: NextRequest) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = sendEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: contact, error: contactError } = await db
    .from("contacts")
    .select("*")
    .eq("id", parsed.data.contact_id)
    .maybeSingle();
  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "contact not found" }, { status: 404 });

  let subject = parsed.data.subject;
  let html = parsed.data.html;
  let logPrefix: string | undefined;

  if (parsed.data.template_id) {
    const { data: template, error: templateError } = await db
      .from("message_templates")
      .select("*")
      .eq("id", parsed.data.template_id)
      .maybeSingle();
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
    if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });
    if (template.channel !== "email") {
      return NextResponse.json({ error: "template is not an email template" }, { status: 400 });
    }

    subject = renderTemplate(template.subject ?? template.name, contact);
    html = renderTemplate(template.body, contact);
    logPrefix = `[${template.name}]`;
  }

  if (!subject || !html) {
    // Unreachable given the schema's refine + the template branch above, but keeps
    // TypeScript honest without a non-null assertion.
    return NextResponse.json({ error: "missing subject/html" }, { status: 400 });
  }

  const result = await sendMessageToContact({
    contact,
    channel: "email",
    subject,
    body: html,
    logPrefix,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
