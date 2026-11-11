import { ActionForm } from "@/components/action-form";
import { formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/action-result";
import type { WordPressSyncColumns } from "@/lib/supabase/database.types";

/**
 * כרטיס "באתר" במסך האירוע ובמסך הקורס: האם הוא פעיל (ולכן מפורסם באתר),
 * ומה מצב הסנכרון לוורדפרס. רכיב שרת — הכפתורים הם ActionForm, כך ששגיאה
 * מוצגת במקום ולא נבלעת.
 */
export function WebsiteSyncCard({
  id,
  noun,
  active,
  sync,
  toggleAction,
  retryAction,
}: {
  id: string;
  /** "האירוע" / "הקורס" */
  noun: string;
  active: boolean;
  sync: WordPressSyncColumns;
  toggleAction: (formData: FormData) => Promise<ActionResult>;
  retryAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const wpUrl = process.env.WP_URL?.trim().replace(/\/+$/, "");
  const editUrl =
    wpUrl && sync.wp_post_id ? `${wpUrl}/wp-admin/post.php?post=${sync.wp_post_id}&action=edit` : null;

  return (
    <section
      className="card flex flex-col gap-3"
      style={active ? undefined : { borderColor: "var(--nav-amber)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {active ? (
            <>
              <span className="font-semibold text-[var(--primary)]">{noun} פעיל.</span>{" "}
              <span className="text-[var(--muted)]">דף ההרשמה פתוח, והוא מפורסם באתר.</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-[var(--nav-amber)]">{noun} כבוי.</span>{" "}
              <span className="text-[var(--muted)]">
                דף ההרשמה סגור, ובאתר הוא שמור כטיוטה.
              </span>
            </>
          )}
        </p>
        <ActionForm action={toggleAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={String(!active)} />
          <button type="submit" className={active ? "btn-secondary" : "btn-primary"}>
            {active ? "כיבוי והחזרה לטיוטה" : "הפעלה ופרסום באתר"}
          </button>
        </ActionForm>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3 text-[12.5px]">
        <p>
          {sync.wp_sync_error ? (
            <span style={{ color: "var(--danger)" }}>
              העדכון לאתר נכשל: {sync.wp_sync_error}. ננסה שוב אוטומטית.
            </span>
          ) : sync.wp_sync_pending ? (
            <span className="text-[var(--muted)]">מעדכן את האתר…</span>
          ) : sync.wp_synced_at ? (
            <span className="text-[var(--muted)]">האתר עודכן ב-{formatDateTime(sync.wp_synced_at)}</span>
          ) : (
            <span className="text-[var(--muted)]">עוד לא נשלח לאתר.</span>
          )}
          {editUrl && (
            <>
              {" · "}
              <a href={editUrl} target="_blank" rel="noopener noreferrer" className="underline">
                פוסט {sync.wp_post_id} באתר
              </a>
            </>
          )}
        </p>
        <ActionForm action={retryAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className="btn-secondary">
            עדכון האתר עכשיו
          </button>
        </ActionForm>
      </div>
    </section>
  );
}
