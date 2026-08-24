import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { updateContactStatus } from "@/lib/automation-engine";
import { resolveStatus } from "@/lib/statuses";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/contacts/[id]">) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ contact: data });
}

const patchContactSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

// Status changes are routed through updateContactStatus so this endpoint and the
// dashboard's "change status" action always trigger the same status_change
// automation rules — see src/lib/automation-engine.ts.
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/contacts/[id]">) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = patchContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { status, ...rest } = parsed.data;

  // ולידציה מול טבלת contact_statuses (0003_statuses.sql) — ה-DB היה דוחה
  // סטטוס לא קיים ממילא דרך המפתח הזר, אבל כ-500 ולא כשגיאת קלט ברורה.
  if (status && !(await resolveStatus(status))) {
    return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
  }

  try {
    if (Object.keys(rest).length > 0) {
      const { error } = await supabaseAdmin().from("contacts").update(rest).eq("id", id);
      if (error) throw error;
    }

    if (status) {
      const { contact } = await updateContactStatus(id, status);
      return NextResponse.json({ contact });
    }

    const { data, error } = await supabaseAdmin()
      .from("contacts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return NextResponse.json({ contact: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
