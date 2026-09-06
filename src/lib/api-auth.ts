import "server-only";

import { readTeamClaims } from "./auth-claims";

/**
 * Session check for Route Handlers under /api that the dashboard itself calls
 * (contacts CRUD, manual send). Returns null instead of redirecting — unlike
 * ./dal's verifyTeamMember, API routes should answer 401 JSON, not redirect an
 * XHR/fetch call to /login.
 *
 * NOT used by /api/webhooks/green-api (webhookUrlToken bearer auth) or
 * /api/cron/check-rules (Vercel's CRON_SECRET bearer token) — neither call carries a
 * team member's session.
 *
 * הבדיקה עצמה משותפת עם ה-DAL (./auth-claims). זה חשוב במיוחד כאן: פתיחת
 * שורה ב"לקוחות פעילים" קוראת ל-/api/contacts/[id]/thread, ובגרסה הקודמת כל
 * פתיחה כזו שילמה על נסיעה נפרדת לשרת האימות לפני שהשיחה בכלל נשלפה.
 */
export async function requireTeamSession() {
  return readTeamClaims();
}
