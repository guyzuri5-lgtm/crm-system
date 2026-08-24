import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Browser Supabase client (anon key). Not currently used by any page — login and
 * sign-out are implemented as Server Actions (see src/app/login) so the session
 * cookie is always set server-side. Kept here for future client-side needs
 * (e.g. Supabase Realtime subscriptions on the contacts table).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
