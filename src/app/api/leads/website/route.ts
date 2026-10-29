import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usableEmail, normalizePhone } from "@/lib/quiz";
import { defaultStatus } from "@/lib/statuses";
import { formatDateTime } from "@/lib/dates";
import { kickoffJourneysForContact } from "@/lib/journey-engine";

// POST /api/leads/website — לידים מהמדריכים החינמיים הנעולים ב-spiritualguy.co.il.
//
// בניגוד לשאלון (/api/webhooks/quiz), הבקשה לא מגיעה מהדפדפן של הגולש אלא
// מהשרת של וורדפרס, ולכן אפשר להגן עליה בסוד אמיתי: X-Site-Secret מול
// WEBSITE_LEAD_SECRET. הסוד לא נחשף לגולש, ואין כאן CORS בכוונה — דפדפן
// שינסה לקרוא לכתובת ישירות ייחסם.
//
// ההסכמה לדיוור נשמרת בשני מקומות: בשדה "הסכמה לדיוור (אתר)" בכרטיס איש
// הקשר (contacts.custom.website_consent_at — הפעם האחרונה), וביומן איש הקשר
// עם חותמת זמן לכל פתיחת מדריך — זו ההוכחה המלאה, כולל איזה דף ומתי.
// שדה ולא עמודה, כדי שהקליטה לא תחכה למיגרציה.

export const dynamic = "force-dynamic";

const SOURCE = "אתר – מדריך חינמי";
const CONSENT_FIELD_KEY = "website_consent_at";

const payloadSchema = z.object({
  name: z.string().trim().min(1, "חסר שם").max(200),
  email: z.string().trim().max(320),
  phone: z.string().trim().max(40),
  marketing_consent: z.literal(true, { error: "נדרשת הסכמה לדיוור (marketing_consent: true)" }),
  guide_slug: z
    .string()
    .trim()
    .min(1, "חסר guide_slug")
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, "guide_slug יכול להכיל רק אותיות באנגלית, ספרות ומקפים"),
  guide_title: z.string().trim().max(200).optional().default(""),
  page_url: z.string().trim().max(1000).optional().default(""),
});

function secretMatches(given: string | null): boolean {
  const expected = process.env.WEBSITE_LEAD_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!process.env.WEBSITE_LEAD_SECRET) {
    console.error("[website-lead] WEBSITE_LEAD_SECRET לא מוגדר — כל הבקשות נדחות");
  }
  if (!secretMatches(request.headers.get("x-site-secret"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ ok: false, error: "גוף הבקשה חייב להיות JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: first ? `${first.path.join(".") || "payload"}: ${first.message}` : "payload לא תקין" },
      { status: 400 }
    );
  }
  const p = parsed.data;

  const email = usableEmail(p.email);
  if (!email) return NextResponse.json({ ok: false, error: "email: כתובת מייל לא תקינה" }, { status: 400 });
  const phone = normalizePhone(p.phone);
  if (!phone) return NextResponse.json({ ok: false, error: "phone: מספר טלפון ישראלי לא תקין" }, { status: 400 });

  const db = supabaseAdmin();
  const now = new Date();
  const tag = `מדריך: ${p.guide_slug}`;
  const guideLabel = p.guide_title || p.guide_slug;

  const contact = await upsertContact(db, { name: p.name, email, phone, tag, consentAt: now });
  if ("error" in contact) {
    console.error("[website-lead] שמירת איש הקשר נכשלה:", contact.error);
    return NextResponse.json({ ok: false, error: "שמירת הליד נכשלה" }, { status: 500 });
  }

  // היומן הוא ההוכחה להסכמה: מה, מאיזה דף ומתי (created_at של השורה).
  // השורה הראשונה היא שם המדריך בלבד — היא מה שמוצג ברשימה ובכרטיס.
  const entry = {
    contact_id: contact.id,
    type: "guide_lead" as const,
    content: [
      guideLabel,
      `${contact.created ? "נרשם" : "פתח מדריך נוסף"} באתר (${p.guide_slug})`,
      `אישר קבלת דיוור שיווקי ב-${formatDateTime(now)}`,
      p.page_url ? `דף: ${p.page_url}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
  let { error: logError } = await db.from("interactions").insert(entry);
  // 22P02 = הערך guide_lead עוד לא ב-enum, כלומר 0052 לא רצה. עדיף רישום
  // בסוג הישן מאשר פתיחת מדריך — וההסכמה שבה — שלא נרשמה בכלל.
  if (logError?.code === "22P02") {
    ({ error: logError } = await db.from("interactions").insert({ ...entry, type: "course_lead" }));
  }
  if (logError) console.error("[website-lead] רישום ביומן נכשל:", logError.message);

  // מסע שמחכה לליד חדש (למשל לפי סטטוס) יוצא עכשיו ולא בריצת הקרון הבאה.
  if (contact.created) after(() => kickoffJourneysForContact(contact.id));

  return NextResponse.json({ ok: true });
}

type Db = ReturnType<typeof supabaseAdmin>;

/**
 * התאמה לפי טלפון (ייחודי בסכימה) ואז לפי מייל. בליד קיים לא נוגעים בשם,
 * בסטטוס ובמקור — רק מוסיפים תגית, משלימים פרטים חסרים ומעדכנים את ההסכמה.
 */
async function upsertContact(
  db: Db,
  lead: { name: string; email: string; phone: string; tag: string; consentAt: Date },
  retried = false
): Promise<{ id: string; created: boolean } | { error: string }> {
  type Existing = { id: string; full_name: string | null; email: string | null; phone: string | null; tags: string[]; custom: Record<string, string> | null };
  const columns = "id, full_name, email, phone, tags, custom";

  let existing: Existing | null = null;
  {
    const { data, error } = await db.from("contacts").select(columns).eq("phone", lead.phone).maybeSingle();
    if (error) return { error: error.message };
    existing = data as Existing | null;
  }
  if (!existing) {
    const { data, error } = await db.from("contacts").select(columns).ilike("email", lead.email).limit(1);
    if (error) return { error: error.message };
    existing = (data?.[0] as Existing | undefined) ?? null;
  }

  const consentValue = formatDateTime(lead.consentAt);

  if (existing) {
    const { error } = await db
      .from("contacts")
      .update({
        full_name: existing.full_name || lead.name,
        email: existing.email || lead.email,
        phone: existing.phone || lead.phone,
        tags: Array.from(new Set([...(existing.tags ?? []), lead.tag])),
        custom: { ...(existing.custom ?? {}), [CONSENT_FIELD_KEY]: consentValue },
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    return { id: existing.id, created: false };
  }

  const { data, error } = await db
    .from("contacts")
    .insert({
      full_name: lead.name,
      email: lead.email,
      phone: lead.phone,
      status: (await defaultStatus()) ?? undefined,
      source: SOURCE,
      tags: [lead.tag],
      custom: { [CONSENT_FIELD_KEY]: consentValue },
    })
    .select("id")
    .single();

  if (error) {
    // מרוץ: אותו טלפון נוצר בין הבדיקה לכתיבה (למשל לחיצה כפולה בטופס)
    if (error.code === "23505" && !retried) return upsertContact(db, lead, true);
    return { error: error.message };
  }
  return { id: data.id, created: true };
}
