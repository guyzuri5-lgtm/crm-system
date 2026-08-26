import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { renderTemplate } from "@/lib/templates";
import { sendMessageToContact } from "@/lib/send";

// POST /api/send/whatsapp — שליחת הודעת וואטסאפ לאיש קשר, לפי תבנית או כטקסט חופשי.
//
// הבחירה בין השתיים אינה של הקורא אלא של חלון 24 השעות, ו-sendMessageToContact
// עושה אותה בעצמו: בתוך החלון נשלח הטקסט, ומחוצה לו התבנית המאושרת. לכן די
// כאן להעביר את שניהם ולתת לו להחליט.
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
  let logPrefix: string | undefined;
  let template = null;

  if (parsed.data.template_id) {
    const { data: found, error: templateError } = await db
      .from("message_templates")
      .select("*")
      .eq("id", parsed.data.template_id)
      .maybeSingle();
    if (templateError) return NextResponse.json({ error: templateError.message }, { status: 500 });
    if (!found) return NextResponse.json({ error: "template not found" }, { status: 404 });
    if (found.channel !== "whatsapp") {
      return NextResponse.json({ error: "template is not a whatsapp template" }, { status: 400 });
    }

    template = found;
    text = renderTemplate(found.body, contact);
    logPrefix = `[${found.name}]`;
  }

  if (!text) {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const result = await sendMessageToContact({
    contact,
    channel: "whatsapp",
    body: text,
    template,
    logPrefix,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
