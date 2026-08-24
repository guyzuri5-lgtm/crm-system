"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyTeamMember } from "@/lib/dal";
import { CONTACT_STATUSES } from "@/lib/supabase/database.types";

// Manual contact creation — not driven by the ManyChat webhook. Lets the team add a
// lead by hand (phone lead, walk-in, referral, ...) and gives the dashboard something
// to show/test before ManyChat is wired up.
const createContactSchema = z.object({
  full_name: z.string().min(1, "חובה למלא שם"),
  phone: z.string().optional(),
  email: z.string().email("אימייל לא תקין").optional(),
  status: z.enum(CONTACT_STATUSES),
  tags: z.string().optional(),
});

export async function createContactAction(formData: FormData) {
  await verifyTeamMember();

  const parsed = createContactSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    status: formData.get("status"),
    tags: formData.get("tags") || undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
  }
  const { full_name, phone, email, status, tags } = parsed.data;

  const { error } = await supabaseAdmin().from("contacts").insert({
    full_name,
    phone: phone || null,
    email: email || null,
    status,
    source: "ידני",
    tags: tags
      ? tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
  });

  if (error) {
    throw new Error(
      error.code === "23505" ? "כבר קיים איש קשר עם הטלפון הזה" : error.message
    );
  }

  revalidatePath("/contacts");
}
