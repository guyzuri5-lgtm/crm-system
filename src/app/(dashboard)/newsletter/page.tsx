import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listStatuses } from "@/lib/statuses";
import { countAudienceByStatus } from "@/lib/newsletter";
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

  // גל אחד: רשימת הסטטוסים, כל ספירות הקהל, והניוזלטר לשכפול. קודם השלושה
  // רצו בזה אחר זה, והספירות עצמן היו שאילתה לכל סטטוס — שבע נסיעות לשרת
  // אחרי שתיים אחרות. עכשיו זו שאילתה אחת לכל הספירות, ושלושתן יחד.
  const [statuses, audience, copySource] = await Promise.all([
    listStatuses(),
    countAudienceByStatus().catch((error) => {
      explain(error);
      return null;
    }),
    // "שכפל" מההיסטוריה: אותו תוכן, ניוזלטר חדש. הישן נשאר כפי שנשלח.
    typeof copyId === "string"
      ? supabaseAdmin()
          .from("newsletters")
          .select("subject, blocks, audience")
          .eq("id", copyId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const allCount = audience?.all ?? 0;
  const statusOptions: StatusOption[] = audience
    ? statuses.map((status) => ({
        name: status.name,
        color: status.color,
        count: audience.byStatus.get(status.name) ?? 0,
      }))
    : [];

  let initial: { subject: string; blocks: Newsletter["blocks"]; statuses: string[] } | undefined;
  {
    const data = copySource.data;
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
      <div className="h-page">
        <div>
          <h1>הודעה חדשה</h1>
          <p>
            מייל אחד שיוצא לרשימה. מי שהוסר מרשימת התפוצה לא יקבל אותו — אבל ימשיך לקבל
            מסעות, תזכורות פגישה והודעות אישיות.
          </p>
        </div>
      </div>

      <NewsletterEditor
        allCount={allCount}
        statusOptions={statusOptions}
        initial={initial}
        // הכתובת שממנה יוצא המייל. ציבורית מעצם טבעה — היא מופיעה בכל מייל
        // שנשלח — ולכן אין בעיה להראות אותה בתצוגה המקדימה.
        from={process.env.POSTMARK_FROM}
      />
    </div>
  );
}
