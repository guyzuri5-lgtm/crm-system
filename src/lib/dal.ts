import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { readTeamClaims } from "./auth-claims";

/**
 * Data Access Layer entry point — call this at the top of any Server Component,
 * Server Action, or Route Handler under the dashboard that needs to know who's
 * logged in. proxy.ts already redirects unauthenticated page loads to /login
 * (optimistic check), but per the Next.js auth guide that's not sufficient on its
 * own — this is the secure check, close to the data.
 *
 * Wrapped in React's cache() so multiple calls during one render pass only hit
 * Supabase once. האימות עצמו יושב ב-./auth-claims, כי גם מסלולי ה-API צריכים
 * אותו — ושם מוסבר למה הוא מקומי ולא ברשת.
 */
export const verifyTeamMember = cache(async () => {
  const claims = await readTeamClaims();
  if (!claims) redirect("/login");
  return claims;
});
