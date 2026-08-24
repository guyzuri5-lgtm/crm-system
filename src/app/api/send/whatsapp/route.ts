import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/templates";
import { sendMessageToContact } from "@/lib/send";
import { isWithin24HourWindow } from "@/lib/manychat";

// POST /api/send/whatsapp — per spec section 4. Checks the 24h window itself (via
// sendMessageToContact / isWithin24HourWindow) and picks a free-form message or an
// approved-template Flow accordingly, exactly like the automation engine does.
export const dynamic = "force-dynamic";

const sendWhatsappSchema = z
  .object({
    contact_id: z.string().uuid(),
    template_id: z.string().uuid().optional(),
    body: z.string().min(1).optional(),
  })
  .refine((v) => v.template_id || v.body, {
    message: "provide either template_id or body",
  });

export async function POST(request: NextRequest) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsedBody = await request.json().catch(() => null);
  const parsed = sendWhatsappSchema.safeParse(parsedBody);
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

  let text = parsed.data.body;
  let manychatFlowNs: string | null | undefined;
  let logPrefix: string | undefined;

  if (parsed.data.template_id) {
    const { data: template, error: templateError } = await db
      .from("message_templates")
      .select("*")
      .eq("id", parsed.data.template_id)
      .maybeSingle();
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
    if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });
    if (template.channel !== "whatsapp") {
      return NextResponse.json({ error: "template is not a whatsapp template" }, { status: 400 });
    }

    text = renderTemplate(template.body, contact);
    manychatFlowNs = template.manychat_template_id;
    logPrefix = `[${template.name}]`;
  } else if (!isWithin24HourWindow(contact.last_incoming_message_at)) {
    // A raw, non-template body can only legally go out inside the 24h window — outside
    // it, WhatsApp requires a Meta-approved template, which means a template_id here.
    return NextResponse.json(
      {
        error:
          "איש הקשר מחוץ לחלון 24 השעות — צריך לשלוח דרך template_id של תבנית מאושרת, לא טקסט חופשי",
      },
      { status: 422 }
    );
  }

  if (!text) {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const result = await sendMessageToContact({
    contact,
    channel: "whatsapp",
    body: text,
    manychatFlowNs,
    logPrefix,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
