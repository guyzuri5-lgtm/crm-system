import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamSession } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { CONTACT_STATUSES, type ContactStatus } from "@/lib/supabase/database.types";

function isContactStatus(value: string): value is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(value);
}

// GET/POST /api/contacts — per spec section 4 ("CRUD לדשבורד"). The dashboard's own
// pages read contacts directly via the Supabase server client (see
// src/app/(dashboard)/contacts/page.tsx) rather than calling this over HTTP — that's
// the more idiomatic App Router pattern and avoids a pointless self-fetch. This route
// exists as the general-purpose REST surface the spec asks for (future external
// tools, scripts, etc.), protected the same way: a logged-in team member.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const tag = searchParams.get("tag");
  const search = searchParams.get("q");

  let query = supabaseAdmin()
    .from("contacts")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    if (!isContactStatus(status)) {
      return NextResponse.json({ error: `invalid status: ${status}` }, { status: 400 });
    }
    query = query.eq("status", status);
  }
  if (tag) query = query.contains("tags", [tag]);
  if (search) {
    const escaped = search.replace(/[%_,]/g, (c) => `\\${c}`);
    query = query.or(
      `full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ contacts: data });
}

const createContactSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireTeamSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("contacts")
    .insert({ source: "ידני", ...parsed.data })
    .select("*")
    .single();

  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ contact: data }, { status: 201 });
}
