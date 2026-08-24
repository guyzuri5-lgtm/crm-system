import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Privileged Supabase client using the SERVICE ROLE key — bypasses RLS entirely.
 * Server-only by construction (`import "server-only"` fails the build if this ever
 * ends up in a client bundle). Use this for all app data access (contacts,
 * interactions, automation_rules, message_templates): every team member has the same
 * permission level (per spec), so per-user RLS isn't the access-control model here —
 * "is there a valid team session" (checked separately via ./server's getClaims) is.
 *
 * Never import this file from a Client Component, and never forward the service role
 * key to the browser.
 */
let _admin: ReturnType<typeof createClient<Database>> | undefined;

export function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}
