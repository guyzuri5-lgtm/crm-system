import Link from "next/link";
import { verifyTeamMember } from "@/lib/dal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { statusMap } from "@/lib/statuses";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import type { Contact } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * מי ביקש לא לקבל דיוור, ומתי.
 *
 * ── למה מסך ולא ייצוא חד-פעמי ──
 * ההסרה היא בקשה של אדם, והתיעוד שלה צריך להיות זמין ברגע שנשאלת השאלה
 * "למה היא לא קיבלה". רשימה שנוצרה פעם אחת מתיישנת בלחיצה הבאה של מישהו
 * על הקישור שבתחתית המייל.
 *
 * ── מה ההסרה *אינה* ──
 * `unsubscribed_at` חוסם ניוזלטרים בלבד (ר' audienceQuery ב-lib/newsletter.ts).
 * מסעות, כללים, תזכורות פגישה והודעות ידניות ממשיכים — ולכן המסך אומר את זה
 * במפורש, כדי שאיש לא יסיק מכאן שאסור לפנות לאדם הזה בכלל.
 */
export default async function UnsubscribedPage() {
  await verifyTeamMember();

  const db = supabaseAdmin();

  const [{ data, error }, { count: active, error: activeError }, statuses] = await Promise.all([
    db
      .from("contacts")
      .select("*")
      .not("unsubscribed_at", "is", null)
      .order("unsubscribed_at", { ascending: false })
      .limit(500),
    // אותו תנאי בדיוק כמו קהל "כל אנשי הקשר", כדי ששתי המספרים במשפט אחד
      // יהיו באמת שני צדדים של אותה רשימה.
    db
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .not("email", "is", null)
      .neq("email", "")
      .is("unsubscribed_at", null),
    statusMap(),
  ]);

  if (error || activeError) {
    throw new Error(
      "לא הצלחנו לקרוא את רשימת ההסרות. אם זה חוזר, ייתכן שמיגרציה 0022_newsletters.sql לא רצה במסד."
    );
  }

  const removed = (data ?? []) as Contact[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">הסרות מרשימת התפוצה</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          מי שלחץ &rdquo;להסרה מרשימת התפוצה&rdquo; בתחתית ניוזלטר, ומתי. הם לא יקבלו דיוור —
          אבל ממשיכים לקבל מסעות, תזכורות פגישה והודעות אישיות.
        </p>
      </div>

      <div className="card text-sm">
        {removed.length ? (
          <>
            <span className="font-medium tabular-nums">{removed.length}</span> הוסרו מרשימת התפוצה.{" "}
            <span className="text-[var(--muted)]">
              נשארו <span className="tabular-nums">{active ?? 0}</span> נמענים פעילים.
            </span>
          </>
        ) : (
          <span className="text-[var(--muted)]">
            אף אחד עוד לא הוסר מרשימת התפוצה. <span className="tabular-nums">{active ?? 0}</span>{" "}
            נמענים פעילים.
          </span>
        )}
      </div>

      {removed.length > 0 && (
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="th">שם</th>
                <th className="th">מייל</th>
                <th className="th">טלפון</th>
                <th className="th">סטטוס</th>
                <th className="th">מתי הוסר</th>
              </tr>
            </thead>
            <tbody>
              {removed.map((contact) => (
                <tr
                  key={contact.id}
                  className="tr-hover border-b border-[var(--border)] last:border-0"
                >
                  <td className="td font-medium">
                    <Link href={`/contacts/${contact.id}`} className="hover:underline">
                      {contact.full_name || "ללא שם"}
                    </Link>
                  </td>
                  <td className="td text-[var(--muted)]">{contact.email || "—"}</td>
                  <td className="td whitespace-nowrap text-[var(--muted)]">
                    {contact.phone || "—"}
                  </td>
                  <td className="td">
                    <StatusBadge
                      status={contact.status}
                      color={statuses.get(contact.status)?.color}
                    />
                  </td>
                  <td className="td whitespace-nowrap">
                    {formatDateTime(contact.unsubscribed_at, {
                      day: "numeric",
                      month: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
