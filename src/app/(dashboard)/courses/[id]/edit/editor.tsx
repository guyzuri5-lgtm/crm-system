"use client";

import { useState, useTransition } from "react";
import { RegistrationLanding, RegistrationThanks } from "@/components/registration-page";
import {
  EVENT_FIELD_TYPE_LABELS,
  type CourseCustomField,
  type CourseRow,
} from "@/lib/supabase/database.types";
import { saveCourseDesignAction, uploadCourseImageAction } from "../../actions";

/**
 * עורך העיצוב של דף ההרשמה לקורס.
 *
 * ── למה state מקומי אחד ושמירה בכפתור ──
 * כל שדה כאן משנה את מה שהתצוגה שמימין מציגה, והתצוגה הזו היא *אותו רכיב*
 * שמרנדר את הדף הציבורי (src/components/registration-page.tsx). שמירה אוטומטית
 * לכל הקלדה הייתה מייצרת עשרות כתיבות למסד תוך כדי ניסוח כותרת, ובעיקר: היא
 * הייתה משנה דף חי שכבר נשלח לקהל, באמצע עריכה.
 *
 * ── ההבדל מעורך האירועים ──
 * אין תאריך, שעה, מיקום וקיבולת, ולכן אין גם previewStartsAt ואין מתגי
 * "הצג תאריך" ו"הצג מקומות". במקומם יש מתג אחד שאין לאירועים: החיבור
 * ל-webhook הישן.
 */

type Draft = {
  name: string;
  subtitle: string;
  form_description: string;
  button_text: string;
  header_image_url: string;
  thankyou_title: string;
  thankyou_text: string;
  thankyou_show_image: boolean;
  custom_fields: CourseCustomField[];
  grow_link: string;
  legacy_webhook: boolean;
};

type TabKey = "landing" | "thanks" | "fields";

const TABS: { key: TabKey; label: string }[] = [
  { key: "landing", label: "דף ההרשמה" },
  { key: "thanks", label: "דף התודה" },
  { key: "fields", label: "שדות הטופס" },
];

/** מפתח יציב לשדה מותאם. נוצר פעם אחת ואינו משתנה עם התווית — התשובות
 *  שכבר נאספו ממופתחות לפיו. */
function newFieldKey(): string {
  return `f${Math.random().toString(36).slice(2, 10)}`;
}

export function CourseDesignEditor({ course }: { course: CourseRow }) {
  const [draft, setDraft] = useState<Draft>({
    name: course.name,
    subtitle: course.subtitle ?? "",
    form_description: course.form_description ?? "",
    button_text: course.button_text,
    header_image_url: course.header_image_url ?? "",
    thankyou_title: course.thankyou_title,
    thankyou_text: course.thankyou_text ?? "",
    thankyou_show_image: course.thankyou_show_image,
    custom_fields: course.custom_fields ?? [],
    grow_link: course.grow_link ?? "",
    legacy_webhook: course.legacy_webhook,
  });

  const [tab, setTab] = useState<TabKey>("landing");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveCourseDesignAction(course.id, draft);
      setMessage(
        result.ok
          ? { ok: true, text: "נשמר. הדף הציבורי מעודכן." }
          : { ok: false, text: result.error }
      );
    });
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── טור ההגדרות ── */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 rounded-xl bg-[var(--nav-gray-soft)] p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className="flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              style={
                tab === item.key
                  ? { backgroundColor: "white", color: "var(--foreground)", boxShadow: "0 1px 2px rgba(28,26,23,0.06)" }
                  : { color: "var(--muted)" }
              }
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="card flex flex-col gap-4">
          {tab === "landing" && <LandingTab draft={draft} set={set} />}
          {tab === "thanks" && <ThanksTab draft={draft} set={set} />}
          {tab === "fields" && <FieldsTab draft={draft} set={set} setDraft={setDraft} />}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending ? "שומר…" : "שמור"}
          </button>
          <a
            className="btn-secondary"
            href={`/course/${course.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            פתיחת הדף החי
          </a>
          {message && (
            <span
              className="text-sm"
              style={{ color: message.ok ? "var(--primary)" : "var(--danger)" }}
            >
              {message.text}
            </span>
          )}
        </div>
      </div>

      {/* ── התצוגה החיה ── */}
      {/* אותם רכיבים בדיוק שמרנדרים את הדף הציבורי, בלי action — כלומר
          הטופס מוצג ואינו נשלח. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-wide text-[var(--subtle)] uppercase">
          תצוגה חיה
        </p>
        <div className="lg:sticky lg:top-4">
          {tab === "thanks" ? (
            <RegistrationThanks
              design={{
                thankyou_title: draft.thankyou_title,
                thankyou_text: draft.thankyou_text || null,
                thankyou_show_image: draft.thankyou_show_image,
                header_image_url: draft.header_image_url || null,
              }}
            />
          ) : (
            <RegistrationLanding
              design={{
                name: draft.name,
                subtitle: draft.subtitle || null,
                header_image_url: draft.header_image_url || null,
                form_description: draft.form_description || null,
                button_text: draft.button_text,
                custom_fields: draft.custom_fields,
              }}
              spotsLeft={null}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── לשונית: דף ההרשמה ──────────────────────────────────────────────────────

type Setter = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function LandingTab({ draft, set }: { draft: Draft; set: Setter }) {
  return (
    <>
      <ImageField url={draft.header_image_url} onChange={(url) => set("header_image_url", url)} />

      <label className="field-label">
        כותרת
        <input
          className="input"
          value={draft.name}
          maxLength={160}
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      <label className="field-label">
        כותרת משנה
        <input
          className="input"
          value={draft.subtitle}
          maxLength={300}
          onChange={(e) => set("subtitle", e.target.value)}
        />
      </label>

      <label className="field-label">
        תיאור קצר בתוך הטופס
        <textarea
          className="input"
          rows={3}
          value={draft.form_description}
          maxLength={2000}
          onChange={(e) => set("form_description", e.target.value)}
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          זה הטקסט היחיד שמופיע גם בגרסת ההטמעה — שם אין כותרת ואין תמונה.
        </span>
      </label>

      <label className="field-label">
        טקסט הכפתור
        <input
          className="input"
          value={draft.button_text}
          maxLength={80}
          onChange={(e) => set("button_text", e.target.value)}
        />
      </label>
    </>
  );
}

// ── לשונית: דף התודה ───────────────────────────────────────────────────────

function ThanksTab({ draft, set }: { draft: Draft; set: Setter }) {
  return (
    <>
      <label className="field-label">
        כותרת
        <input
          className="input"
          value={draft.thankyou_title}
          maxLength={160}
          onChange={(e) => set("thankyou_title", e.target.value)}
        />
      </label>

      <label className="field-label">
        טקסט
        <textarea
          className="input"
          rows={4}
          value={draft.thankyou_text}
          maxLength={2000}
          onChange={(e) => set("thankyou_text", e.target.value)}
        />
      </label>

      <Toggle
        label="הצגת תמונת הרקע גם כאן"
        checked={draft.thankyou_show_image}
        onChange={(v) => set("thankyou_show_image", v)}
      />

      {/* אין כאן מתג "הוספה ליומן": לקורס אין מועד, ולכן אין מה להוסיף. */}
    </>
  );
}

// ── לשונית: שדות הטופס ─────────────────────────────────────────────────────

function FieldsTab({
  draft,
  set,
  setDraft,
}: {
  draft: Draft;
  set: Setter;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
}) {
  function updateField(index: number, patch: Partial<CourseCustomField>) {
    setDraft((current) => ({
      ...current,
      custom_fields: current.custom_fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field
      ),
    }));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    setDraft((current) => {
      if (target < 0 || target >= current.custom_fields.length) return current;
      const fields = [...current.custom_fields];
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...current, custom_fields: fields };
    });
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">שדות מותאמים</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                custom_fields: [
                  ...current.custom_fields,
                  { key: newFieldKey(), label: "", type: "text", options: [] },
                ],
              }))
            }
          >
            הוספת שדה
          </button>
        </div>

        <p className="text-xs text-[var(--muted)]">
          שם, טלפון ואימייל נשאלים תמיד. כאן מוסיפים את מה שמעבר להם.
        </p>

        {draft.custom_fields.map((field, index) => (
          <div key={field.key} className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="field-label min-w-0 flex-1">
                תווית
                <input
                  className="input"
                  value={field.label}
                  maxLength={120}
                  placeholder="למשל: יש לך ניסיון קודם?"
                  onChange={(e) => updateField(index, { label: e.target.value })}
                />
              </label>

              <label className="field-label">
                סוג
                <select
                  className="input"
                  value={field.type}
                  onChange={(e) =>
                    updateField(index, { type: e.target.value as CourseCustomField["type"] })
                  }
                >
                  {Object.entries(EVENT_FIELD_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-0.5 pb-0.5">
                <button type="button" className="btn-ghost" onClick={() => move(index, -1)} aria-label="הזזה למעלה">
                  ↑
                </button>
                <button type="button" className="btn-ghost" onClick={() => move(index, 1)} aria-label="הזזה למטה">
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      custom_fields: current.custom_fields.filter((_, i) => i !== index),
                    }))
                  }
                >
                  מחיקה
                </button>
              </div>
            </div>

            {field.type === "select" && (
              <label className="field-label mt-3">
                אפשרויות הבחירה
                <textarea
                  className="input"
                  rows={3}
                  value={field.options.join("\n")}
                  placeholder={"אפשרות אחת בכל שורה\nכן\nלא"}
                  onChange={(e) =>
                    updateField(index, {
                      options: e.target.value
                        .split("\n")
                        .map((option) => option.trim())
                        .filter(Boolean)
                        .slice(0, 30),
                    })
                  }
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <hr className="border-[var(--border)]" />

      <span className="text-sm font-medium">פרטי הקורס</span>

      <label className="field-label">
        לינק התשלום בגרואו
        <input
          type="url"
          className="input"
          dir="ltr"
          value={draft.grow_link}
          maxLength={2000}
          onChange={(e) => set("grow_link", e.target.value)}
        />
        <span className="text-xs font-normal text-[var(--subtle)]">
          ריק = הטופס מוביל ישר לעמוד התודה, בלי תשלום.
        </span>
      </label>

      <Toggle
        label="לידים מדף הנחיתה הישן נכנסים לקורס הזה"
        checked={draft.legacy_webhook}
        onChange={(v) => set("legacy_webhook", v)}
      />
      <p className="-mt-2 text-xs leading-relaxed text-[var(--muted)]">
        דף הנחיתה הישן של קורס המדיטציה ממשיך לעבוד כרגיל וממשיך לרשום לידים.
        עם המתג הזה כל ליד חדש שנקלט בו יירשם <em>גם</em> כמתעניין בקורס הזה,
        וכך ייכנס למסעות ולמונים. אפשר לסמן קורס אחד בלבד — סימון כאן מוריד
        את הסימון מקורס אחר.
      </p>
    </>
  );
}

// ── רכיבי עזר ──────────────────────────────────────────────────────────────

function ImageField({ url, onChange }: { url: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.set("image", file);
    const result = await uploadCourseImageAction(formData);
    setUploading(false);
    if (result.ok) onChange(result.url);
    else setError(result.error);
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">תמונת רקע</span>

      {url ? (
        <div
          className="h-28 rounded-xl bg-cover bg-center"
          style={{ backgroundImage: `url(${JSON.stringify(url)})` }}
        />
      ) : (
        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] text-sm text-[var(--subtle)]">
          בלי תמונה — הכותרת תוצג על רקע בצבע המותג
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer">
          {uploading ? "מעלה…" : url ? "החלפת תמונה" : "העלאת תמונה"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // איפוס הערך: בלעדיו בחירה חוזרת באותו קובץ לא מפעילה change.
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </label>
        {url && (
          <button type="button" className="btn-danger" onClick={() => onChange("")}>
            הסרה
          </button>
        )}
      </div>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? "var(--primary)" : "var(--border-strong)" }}
      >
        {/* RTL: הכפתור נע ימינה כשכבוי ושמאלה כשדלוק, כדי שהתנועה תתאים
            לכיוון הקריאה. */}
        <span
          className="absolute top-0.5 size-5 rounded-full bg-[var(--knob)] shadow-sm transition-all"
          style={checked ? { left: "0.125rem" } : { right: "0.125rem" }}
        />
      </button>
    </label>
  );
}
