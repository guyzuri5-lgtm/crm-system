import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Auth-only Supabase client for server code (Server Components, Server Actions,
 * Route Handlers). Uses the anon/publishable key and reads/writes the session via
 * Next.js cookies, per the @supabase/ssr contract (getAll/setAll — the deprecated
 * get/set/remove trio is NOT used here, see @supabase/ssr's own warnings about it).
 *
 * Use this for anything touching `supabase.auth.*` (login, logout, getClaims). For
 * reading/writing app data (contacts, interactions, ...), use `supabaseAdmin` from
 * ./admin instead — this project gives every team member the same permission level,
 * so RLS-per-user isn't the access control model; the service role client is simpler
 * and is what the API routes and dashboard pages use.
 *
 * Must be created fresh per request — never module-level singleton (see
 * @supabase/ssr's createServerClient docs).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies (e.g. a page
            // rendered without a following Server Action / route). Harmless as long
            // as proxy.ts is also refreshing the session on every request.
          }
        },
      },
    }
  );
}
