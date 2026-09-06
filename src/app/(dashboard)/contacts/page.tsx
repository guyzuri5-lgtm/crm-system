import Link from "next/link";
import { Suspense } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { ContactsWorkspace, ContactsWorkspaceFallback } from "./workspace";

/**
 * עמוד אנשי הקשר — כותרת מיד, טבלה בזרם.
 *
 * הכותרת והקישורים לניהול השדות והסטטוסים אינם תלויים בשום שאילתה, ולכן הם
 * נצבעים ברגע הלחיצה. הטבלה ושלוש השאילתות שמזינות אותה יושבות מאחורי
 * <Suspense> ומחליפות את השלד כשהן חוזרות.
 *
 * ה-key על ה-Suspense הוא מה שגורם לשלד לחזור גם *בתוך* העמוד: חיפוש חדש או
 * מעבר עמוד משנים את הכתובת, וכשה-key משתנה React מחליף את הגבול במקום
 * לעדכן אותו — כלומר הטבלה חוזרת לשלד במקום להיתקע על התוצאה הישנה בזמן
 * שהחדשה נטענת.
 */
export default async function ContactsPage(props: PageProps<"/contacts">) {
  await verifyTeamMember();
  const searchParams = await props.searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="h-page">
        <div>
          <h1>כל אנשי הקשר</h1>
          <p>
            כל מי שנמצא במערכת, כולל מי שיובא מאקסל ומעולם לא כתב. סימון שורות פותח פעולות
            מרוכזות בראש הטבלה.
          </p>
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          <Link href="/settings/fields" className="btn-ghost">
            ניהול שדות
          </Link>
          <Link href="/settings/statuses" className="btn-ghost">
            ניהול סטטוסים
          </Link>
        </div>
      </div>

      <Suspense
        key={`${searchParams.q ?? ""}|${searchParams.status ?? ""}|${searchParams.page ?? ""}`}
        fallback={<ContactsWorkspaceFallback />}
      >
        <ContactsWorkspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
