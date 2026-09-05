import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listStatuses } from "@/lib/statuses";
import { countAudience } from "@/lib/newsletter";
import type { Newsletter } from "@/lib/supabase/database.types";
import { NewsletterEditor, type StatusOption } from "./editor";

export const dynamic = "force-dynamic";

/**
 * הכשל הצפוי כאן הוא מיגרציה שלא רצה — unsubscribed_at הוא חלק מהתנאי של
 * כל ספירת קהל. ההודעה הגולמית של PostgREST לא רומזת מה חסר.
 */
function explain(error: unknown): never {
  const code = (error as { code?: string })?.code;
  if (code && ["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) {
    throw new Error(
      "טבלאות הניוזלטר לא קיימות. יש להריץ את supabase/migrations/0022_newsletters.sql ב-SQL editor של Supabase."
    );
  }
  throw error;
}

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifyTeamMember();

  const copyId = (await searchParams).copy;
  const statuses = await listStatuses();

  let allCount = 0;
  let statusOptions: StatusOption[] = [];
  try {
    const [all, ...perStatus] = await Promise.all([
      countAudience({ type: "all" }),
      ...statuses.map((status) => countAudience({ type: "statuses", statuses: [status.name] })),
    ]);
    allCount = all;
    statusOptions = statuses.map((status, index) => ({
      name: status.name,
      color: status.color,
      count: perStatus[index] ?? 0,
    }));
  } catch (error) {
    explain(error);
  }

  // "שכפל" מההיסטוריה: אותו תוכן, ניוזלטר חדש. הישן נשאר כפי שנשלח.
  let initial: { subject: string; blocks: Newsletter["blocks"]; statuses: string[] } | undefined;
  if (typeof copyId === "string") {
    const { data } = await supabaseAdmin()
      .from("newsletters")
      .select("subject, blocks, audience")
      .eq("id", copyId)
      .maybeSingle();
    if (data) {
      initial = {
        subject: data.subject,
        blocks: data.blocks ?? [],
        statuses: data.audience?.type === "statuses" ? data.audience.statuses : [],
      };
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">הודעה חדשה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מייל אחד שיוצא לרשימה. מי שהוסר מרשימת התפוצה לא יקבל אותו — אבל ימשיך לקבל
          מסעות, תזכורות פגישה והודעות אישיות.
        </p>
      </div>

      <NewsletterEditor allCount={allCount} statusOptions={statusOptions} initial={initial} />
    </div>
  );
}
