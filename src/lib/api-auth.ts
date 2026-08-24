import "server-only";

import { createSupabaseServerClient } from "./supabase/server";

/**
 * Session check for Route Handlers under /api that the dashboard itself calls
 * (contacts CRUD, manual send). Returns null instead of redirecting — unlike
 * ./dal's verifyTeamMember, API routes should answer 401 JSON, not redirect an
 * XHR/fetch call to /login.
 *
 * NOT used by /api/webhooks/manychat (shared-secret auth) or /api/cron/check-rules
 * (Vercel's CRON_SECRET bearer token) — neither call carries a team member's session.
 */
export async function requireTeamSession() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims) return null;

  return {
    userId: data.claims.sub as string,
    email: (data.claims.email as string | undefined) ?? null,
  };
}
