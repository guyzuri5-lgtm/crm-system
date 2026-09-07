"use client";

import { useActionState, useState } from "react";
import {
  COURSE_STAGES,
  COURSE_STAGE_LABELS,
  type CourseStage,
  type MessageChannel,
  type MessageTemplate,
} from "@/lib/supabase/database.types";
import type { AudienceCounts } from "@/lib/course-broadcast";
import {
  sendCourseBroadcastAction,
  type CourseBroadcastResult,
} from "../../actions";

/**
 * טופס השליחה הידנית לנרשמי הקורס.
 *
 * ── למה הערוץ הוא המתג העליון ולא שדה בין השאר ──
 * הוא משנה את כל מה שמתחתיו: גם מי ניתנת להשגה (מייל דורש כתובת, וואטסאפ
 * דורש טלפון), וגם איך כותבים את ההודעה. מתג במקום שלישי בטופס היה מחליף
 * לגיא את חצי המסך אחרי שכבר מילא אותו.
 */
export function BroadcastCompose({
  courseId,
  counts,
  templates,
}: {
  courseId: string;
  counts: AudienceCounts;
  templates: MessageTemplate[];
}) {
  const [channel, setChannel] = useState<MessageChannel>("whatsapp");
  const [stages, setStages] = useState<CourseStage[]>([...COURSE_STAGES]);

  // ── למה הכותרת והגוף מוחזקים ב-state ולא כשדות חופשיים ──
  //
  // React מאפס טופס לא-מבוקר אחרי שפעולת שרת חוזרת. כשהשליחה נכשלת — אין
  // נמענים, השליחה מושהית — הטקסט שנכתב פשוט נמחק, והכותב מגלה שהוא איבד
  // מה שניסח. זה קרה בפועל. ה-state שומר עליו כדי שיהיה אפשר לתקן את
  // הבחירה ולשלוח שוב, בלי לכתוב הכול מחדש.
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [state, formAction, pending] = useActionState<CourseBroadcastResult | null, FormData>(
    async (_prev, formData) => {
      const result = await sendCourseBroadcastAction(null, formData);
      // מנוקה רק אחרי הצלחה. כישלון משאיר את הטקסט על המסך — זו כל הנקודה
      // של ה-state שמעליו.
      if (result.ok) {
        setSubject("");
        setBody("");
      }
      return result;
    },
    null
  );

  const total = stages.reduce((sum, stage) => sum + counts[channel][stage], 0);

  function toggleStage(stage: CourseStage) {
    setStages((current) =>
      current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage]
    );
  }

  return (
    <form action={formAction} className="card flex flex-col gap-6">
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="channel" value={channel} />

      {/* ── הערוץ ── */}
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label mb-2">באיזה ערוץ</legend>
        <div className="flex gap-2">
          <ChannelButton
            active={channel === "whatsapp"}
            onClick={() => setChannel("whatsapp")}
            label="וואטסאפ"
            hint="תבנית מאושרת"
          />
          <ChannelButton
            active={channel === "email"}
            onClick={() => setChannel("email")}
            label="מייל"
            hint="טקסט חופשי"
          />
        </div>
      </fieldset>

      {/* ── הנמענים ── */}
      <fieldset className="flex flex-col gap-2">
        <legend className="field-label mb-2">למי</legend>
        <div className="flex flex-col gap-2">
          {COURSE_STAGES.map((stage) => {
            const checked = stages.includes(stage);
            const count = counts[channel][stage];
            return (
              <label
                key={stage}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${
                  checked
                    ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                    : "border-[var(--border)]"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    name="stages"
                    value={stage}
                    checked={checked}
                    onChange={() => toggleStage(stage)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <span className="font-medium">{COURSE_STAGE_LABELS[stage]}</span>
                </span>
                {/* המספר הוא של הערוץ הנבחר, ולכן הוא מתחלף עם המתג. זו לא
                    קוסמטיקה: מי שאין לו מייל פשוט לא יקבל, ועדיף לראות את
                    זה לפני הלחיצה מאשר בעמודת הכשלים אחריה. */}
                {/* --muted ולא --subtle: על רקע ה-tint של שורה מסומנת נמדד
                    --subtle ב-4.2 בשני המצבים, כלומר מתחת ל-AA לטקסט קטן.
                    המספר הזה הוא המידע שמכריע את הלחיצה — הוא חייב להיקרא. */}
                <span className="shrink-0 text-xs text-[var(--muted)]">
                  {count === 0
                    ? "אף אחד"
                    : `${count} ${channel === "email" ? "עם מייל" : "עם טלפון"}`}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ── התוכן ── */}
      {channel === "email" ? (
        <div className="flex flex-col gap-4">
          <label className="field-label">
            כותרת המייל
            <input
              name="subject"
              required
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input"
              placeholder="עדכון חשוב לגבי הקורס"
            />
          </label>
          <label className="field-label">
            ההודעה
            <textarea
              name="body"
              required
              rows={9}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input resize-y"
              placeholder={"היי {{first_name}},\n\nרציתי לעדכן אותך ש…"}
            />
          </label>
          <p className="text-xs leading-relaxed text-[var(--subtle)]">
            שורה ריקה פותחת פסקה חדשה. אפשר להשתמש ב-
            <span dir="ltr" className="font-medium">{" {{first_name}} "}</span>,
            <span dir="ltr" className="font-medium">{" {{full_name}} "}</span> —
            הם יוחלפו בשם של כל נמען. בתחתית המייל נוסף קישור הסרה, כמו בניוזלטר.
          </p>
        </div>
      ) : (
        <WhatsAppContent templates={templates} />
      )}

      {/* ── השליחה ── */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || total === 0 || (channel === "whatsapp" && templates.length === 0)}
        >
          {pending
            ? "יוצר…"
            : total === 0
              ? "לא נבחרו נמענים"
              : total === 1
                ? "שליחה לנמען אחד"
                : `שליחה ל-${total} נמענים`}
        </button>
        <span className="text-xs text-[var(--subtle)]">
          ההודעות יוצאות ברקע, בקצב מבוקר — לא הכול בבת אחת.
        </span>
      </div>

      {state && !state.ok && (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="rounded-lg bg-[var(--ok-soft)] px-3 py-2 text-sm text-[var(--ok)]">
          נוצרה שליחה ל-{state.count} נמענים. היא יוצאת ברקע — ההתקדמות מופיעה למטה
          ומתעדכנת עם רענון הדף.
        </p>
      )}
    </form>
  );
}

function ChannelButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-xl border px-4 py-3 text-start transition-colors ${
        active
          ? "border-[var(--primary)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]"
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-xs text-[var(--subtle)]">{hint}</span>
    </button>
  );
}

/**
 * תוכן הוואטסאפ: בחירת תבנית, ולא כתיבה.
 *
 * ההסבר כאן ארוך בכוונה ומופיע גם כשיש תבניות. זו השאלה הראשונה שנשאלת מול
 * המסך הזה ("למה אני לא יכול פשוט לכתוב?"), והתשובה אינה מובנת מאליה: היא
 * כלל של מטא, לא החלטה של המערכת.
 */
function WhatsAppContent({ templates }: { templates: MessageTemplate[] }) {
  if (templates.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--nav-amber-soft)] px-4 py-3 text-sm">
        <p className="font-semibold text-[var(--nav-amber)]">אין עדיין תבנית מאושרת</p>
        <p className="mt-1 leading-relaxed text-[var(--muted)]">
          מטא מרשה לשלוח למי שלא כתב לך ב-24 השעות האחרונות רק תבנית שהיא אישרה מראש —
          ורוב הנרשמים לקורס נמצאים שם. צור תבנית במסך{" "}
          <span className="font-medium">תבניות הודעה</span>, שלח אותה לאישור, וכשהיא תאושר
          היא תופיע כאן. עד אז אפשר לשלוח להם במייל.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="field-label">
        התבנית שתישלח
        <select name="template_id" required className="input" defaultValue="">
          <option value="" disabled>
            בחר תבנית…
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-[var(--subtle)]">
        בוואטסאפ בוחרים תבנית ולא כותבים טקסט, כי מטא שולחת למי שלא כתב לך לאחרונה רק את
        הנוסח <span className="font-medium">שהיא אישרה</span>. שינוי הניסוח נעשה במסך
        תבניות ההודעה ועובר אישור מחדש.
      </p>
    </div>
  );
}
