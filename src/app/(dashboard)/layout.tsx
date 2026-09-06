import { Suspense } from "react";
import { verifyTeamMember } from "@/lib/dal";
import { signOut } from "@/app/login/actions";
import { DashboardShell, ChannelBadgeFallback } from "@/components/dashboard-shell";
import { ChannelStatus } from "@/components/channel-status";

/**
 * הפריסה של הדשבורד — ומה שאסור שיהיה בה.
 *
 * ── הכלל ──
 * כל `await` בפריסה חוסם את *כל* המסכים שמתחתיה. Next אינו יכול להציג
 * loading.tsx של עמוד לפני שהפריסה שמעליו סיימה, ולכן שאילתה אחת איטית כאן
 * הופכת לעיכוב בכל לחיצה במערכת. קודם ישבו כאן שתי שאילתות על מצב ערוץ
 * הוואטסאפ, ומסך אנשי הקשר חיכה להן בכל פעם מחדש.
 *
 * מה שנשאר: verifyTeamMember בלבד. הוא חייב להיות כאן — זו בדיקת ההרשאה,
 * והיא זולה (אימות סשן, בלי שאילתת מסד).
 *
 * מצב הערוץ עבר ל-<Suspense>. הוא עדיין נקרא בשרת ועדיין מוצג בכל מסך, אבל
 * הוא כבר לא מעכב דבר: הסרגל והתוכן נצבעים, והנורה נדלקת כשהיא מוכנה.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { email } = await verifyTeamMember();

  return (
    <DashboardShell
      email={email ?? null}
      signOutAction={signOut}
      channel={
        <Suspense fallback={<ChannelBadgeFallback />}>
          <ChannelStatus />
        </Suspense>
      }
    >
      {children}
    </DashboardShell>
  );
}
