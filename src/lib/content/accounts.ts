import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any -- תשובות ה-API של Zernio ושורות content_* לא מוקלדות; הצורה מתועדת בהערות ונבדקת בזמן ריצה */

import { getMeta, setMeta } from "./db";
import { zget, ZernioError } from "./zernio";
import { PLATFORMS, PLATFORM_NAMES, type AccountSummary } from "./pure/platforms";

/** הרשתות המחוברות, מ-GET /accounts. מזהים תמיד מכאן, אף פעם לא מוקלדים. */

export interface PublicAccount {
  id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profilePicture?: string;
  profileUrl?: string;
  profileId: string;
  isActive: boolean;
  needsReconnection: boolean;
  platformStatus?: string | null;
}

function toPublic(a: any): PublicAccount {
  const prof = a.profileId;
  return {
    id: a._id || a.id,
    platform: a.platform,
    username: a.username,
    displayName: a.displayName,
    profilePicture: a.profilePicture,
    profileUrl: a.profileUrl,
    profileId: prof && typeof prof === "object" ? prof._id : prof,
    isActive: a.isActive !== false && a.enabled !== false,
    needsReconnection: Boolean(a.needsReconnection),
    platformStatus: a.platformStatus ?? null,
  };
}

export function healthy(a: PublicAccount) {
  return a.isActive && !a.needsReconnection && (a.platformStatus == null || a.platformStatus === "active");
}

let cache: { at: number; data: PublicAccount[] | null; error: string | null } = { at: 0, data: null, error: null };

export async function fetchAccounts(force = false, maxAgeMs = 300_000): Promise<PublicAccount[]> {
  if (!force && cache.data && Date.now() - cache.at < maxAgeMs) return cache.data;
  try {
    const raw = await zget<any>("/accounts", undefined, "accounts");
    const accs = (raw.accounts || []).map(toPublic);
    cache = { at: Date.now(), data: accs, error: null };
    await setMeta("accounts_cache", { at: Date.now(), accounts: accs });
    return accs;
  } catch (e) {
    cache.error = e instanceof ZernioError ? e.hebrew : String(e);
    if (!cache.data) {
      const c = await getMeta<{ accounts: PublicAccount[] }>("accounts_cache");
      if (c) cache.data = c.accounts;
    }
    return cache.data || [];
  }
}

export async function accountSummary(force = false) {
  const accs = await fetchAccounts(force);
  const platforms: Record<string, any> = {};
  for (const p of PLATFORMS) {
    const rows = accs.filter((a) => a.platform === p).sort((x, y) => Number(healthy(y)) - Number(healthy(x)));
    platforms[p] = {
      platform: p,
      name: PLATFORM_NAMES[p],
      connected: rows.length > 0,
      account: rows[0] || null,
      healthy: rows.length > 0 && healthy(rows[0]),
    };
  }
  return { platforms, error: cache.error, fetchedAt: cache.at } as AccountSummary & { error: string | null; fetchedAt: number };
}

export async function accountFor(platform: string): Promise<PublicAccount | null> {
  const s = await accountSummary();
  return (s.platforms[platform]?.account as PublicAccount) || null;
}
