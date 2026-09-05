import { verifyTeamMember } from "@/lib/dal";
import { NewEventForm } from "./new-event-form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  await verifyTeamMember();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">אירוע חדש</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          קודם מה ומתי. אחרי השמירה נעבור לעיצוב דף ההרשמה — כותרת, תמונה, טקסטים ושדות הטופס.
        </p>
      </div>

      <NewEventForm />
    </div>
  );
}
