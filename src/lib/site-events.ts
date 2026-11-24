import "server-only";

import { supabaseAdmin } from "./supabase/admin";
import { countStages, EVENT_TIMEZONE } from "./events";
import { appUrl } from "./booking/create";

/**
 * האירועים באתר החדש (Astro ב-Cloudflare Pages, המאגר guyzuri5-lgtm/spiritualguy-site).
 * כיוון אחד, כמו הסנכרון לוורדפרס: ה-CRM הוא המקור. כל סנכרון בונה מחדש את
 * הקובץ src/data/events.json מכל האירועים הפעילים שעוד לא נגמרו, ועושה commit
 * רק אם משהו השתנה. Cloudflare בונה את האתר מחדש מה-push (בערך 2 דקות).
 *
 * כל הקובץ נכתב בכל פעם (ולא אירוע אחד): ככה אין מצב חלקי, אירוע שכובה או
 * נגמר פשוט לא נכנס, וכל ריצה של הקרון מתקנת לבד כישלון קודם.
 *
 * הגדרות (Vercel): SITE_GITHUB_TOKEN – fine-grained token עם Contents: Read and write
 * למאגר האתר בלבד. SITE_GITHUB_REPO – ברירת מחדל guyzuri5-lgtm/spiritualguy-site.
 * בלי הטוקן – לא קורה כלום.
 *
 * לא זורק אף פעם: האתר לא מעכב ולא מפיל את ה-CRM.
 */

const FILE_PATH = "src/data/events.json";
const BRANCH = "main";
const REQUEST_TIMEOUT_MS = 10_000;

export type SiteEvent = {
  title: string;
  start: string;
  end: string | null;
  date: string;
  location: string;
  short: string;
  href: string;
  cta: string;
  price: number | null;
  seats_left: number | null;
  crm_id: string;
};

export type SiteEventsOutcome =
  | { ok: true; changed: boolean; count: number }
  | { ok: false; error: string }
  | { ok: true; skipped: "not_configured" };

function config() {
  const token = process.env.SITE_GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repo = process.env.SITE_GITHUB_REPO?.trim() || "guyzuri5-lgtm/spiritualguy-site";
  return { token, repo };
}

/** "יום חמישי, 4 בדצמבר · 19:00" בשעון ישראל. */
function hebrewDate(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("he-IL", {
    timeZone: EVENT_TIMEZONE, weekday: "long", day: "numeric", month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("he-IL", {
    timeZone: EVENT_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return `${day} · ${time}`;
}

/** האירועים כפי שהאתר מציג אותם: פעילים, שעוד לא נגמרו, לפי סדר. */
export async function buildSiteEvents(now: Date = new Date()): Promise<SiteEvent[]> {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select("*")
    .eq("active", true)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`שליפת האירועים נכשלה: ${error.message}`);

  const out: SiteEvent[] = [];
  for (const e of data ?? []) {
    const endsAt = e.ends_at ?? e.starts_at;
    if (new Date(endsAt).getTime() < now.getTime()) continue;
    let seatsLeft: number | null = null;
    if (e.capacity !== null) {
      const counts = await countStages(e.id);
      seatsLeft = Math.max(0, e.capacity - counts.paid);
    }
    out.push({
      title: e.name,
      start: e.starts_at,
      end: e.ends_at,
      date: hebrewDate(e.starts_at),
      location: e.location ?? "",
      short: e.short_description ?? e.subtitle ?? "",
      // כמו בוורדפרס: דף ההרשמה של ה-CRM ולא ישירות גרואו, כדי שהתשלום ישויך.
      href: `${appUrl()}/event/${e.slug}`,
      cta: seatsLeft === 0 ? "ההרשמה מלאה" : "להרשמה",
      price: e.price,
      seats_left: seatsLeft,
      crm_id: e.id,
    });
  }
  return out;
}

async function gh(token: string, url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
}

/** בונה את הקובץ ודוחף אותו אם השתנה. לא זורק. */
export async function syncSiteEvents(now: Date = new Date()): Promise<SiteEventsOutcome> {
  const cfg = config();
  if (!cfg) return { ok: true, skipped: "not_configured" };
  try {
    const events = await buildSiteEvents(now);
    const content = JSON.stringify(events, null, 2) + "\n";
    const api = `https://api.github.com/repos/${cfg.repo}/contents/${FILE_PATH}`;

    const current = await gh(cfg.token, `${api}?ref=${BRANCH}`);
    let sha: string | undefined;
    if (current.ok) {
      const body = (await current.json()) as { sha: string; content: string };
      sha = body.sha;
      const existing = Buffer.from(body.content, "base64").toString("utf8");
      if (existing === content) return { ok: true, changed: false, count: events.length };
    } else if (current.status !== 404) {
      throw new Error(`GitHub החזיר ${current.status} בקריאת הקובץ`);
    }

    const put = await gh(cfg.token, api, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `events: sync from CRM (${events.length})`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
        committer: { name: "CRM", email: "crm@spiritualguy.co.il" },
      }),
    });
    if (!put.ok) throw new Error(`GitHub החזיר ${put.status}: ${(await put.text()).slice(0, 200)}`);
    return { ok: true, changed: true, count: events.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[site-events] הסנכרון לאתר נכשל:", error);
    return { ok: false, error };
  }
}
