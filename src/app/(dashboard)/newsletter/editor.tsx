"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { NewsletterPreview } from "./preview";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { statusLabel } from "@/lib/status-colors";
import { youtubeIdFrom } from "@/lib/youtube";
import type { NewsletterBlock } from "@/lib/supabase/database.types";
import {
  createNewsletterAction,
  sendDraftToSelfAction,
  uploadNewsletterImageAction,
} from "./actions";

/**
 * עורך הניוזלטר: קהל, נושא, ורשימת בלוקים אנכית.
 *
 * בלי גרירה ובלי ספריות — הוספה, מחיקה, ומעלה/מטה. ניוזלטר הוא חמישה בלוקים
 * במקרה הקיצון, וגרירה הייתה עולה יותר ממה שהיא שווה כאן.
 *
 * ה-Server Actions מוחזרות ולא נזרקות: שגיאת שליחה או העלאה מוצגת ליד
 * הכפתור, ולא מפילה את העמוד עם כל התוכן שנכתב בו ל-error.tsx.
 */

export interface StatusOption {
  name: string;
  color: string;
  count: number;
}

/** בלוק חדש לפי סוג, עם הערכים הריקים שלו. */
function emptyBlock(type: NewsletterBlock["type"]): NewsletterBlock {
  if (type === "text") return { type: "text", html: "" };
  if (type === "image") return { type: "image", url: "", alt: "" };
  return { type: "youtube", videoId: "", caption: "" };
}

const BLOCK_LABELS: Record<NewsletterBlock["type"], string> = {
  text: "טקסט",
  image: "תמונה",
  youtube: "סרטון יוטיוב",
};

/** המציינים שאפשר לשתול בטקסט. נגזרים מ-renderTemplate ב-src/lib/templates.ts. */
const PLACEHOLDERS = ["{{first_name}}", "{{full_name}}", "{{email}}", "{{phone}}"];

export function NewsletterEditor({
  allCount,
  statusOptions,
  initial,
  from,
}: {
  allCount: number;
  statusOptions: StatusOption[];
  /** תוכן פותח, כשמגיעים לכאן מ"שכפל" בהיסטוריה. */
  initial?: { subject: string; blocks: NewsletterBlock[]; statuses: string[] };
  /** כתובת השולח, לשורת ה-from בתצוגה המקדימה. ציבורית ממילא. */
  from?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [blocks, setBlocks] = useState<NewsletterBlock[]>(
    initial?.blocks.length ? initial.blocks : [emptyBlock("text")]
  );
  const [selected, setSelected] = useState<string[]>(initial?.statuses ?? []);
  const [scheduling, setScheduling] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // רשימה ריקה = כל אנשי הקשר. הסטטוסים זרים זה לזה, ולכן סכום הספירות הוא
  // מספר הנמענים בפועל.
  const audienceCount = selected.length
    ? statusOptions.filter((s) => selected.includes(s.name)).reduce((sum, s) => sum + s.count, 0)
    : allCount;

  function patchBlock(index: number, patch: Partial<NewsletterBlock>) {
    setBlocks((current) =>
      current.map((block, i) => (i === index ? ({ ...block, ...patch } as NewsletterBlock) : block))
    );
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    setBlocks((current) => {
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function uploadImage(index: number, file: File) {
    const formData = new FormData();
    formData.append("image", file);
    setNotice(null);
    startTransition(async () => {
      const result = await uploadNewsletterImageAction(formData);
      if (result.ok) patchBlock(index, { url: result.url });
      else setNotice({ tone: "bad", text: result.error });
    });
  }

  function draft() {
    return {
      subject,
      blocks,
      statuses: selected,
      date: scheduling ? date : undefined,
      time: scheduling ? time : undefined,
    };
  }

  function submit() {
    setNotice(null);
    startTransition(async () => {
      const result = await createNewsletterAction(draft());
      if (result.ok) router.push("/newsletter/scheduled");
      else setNotice({ tone: "bad", text: result.error });
    });
  }

  function sendToSelf() {
    setNotice(null);
    startTransition(async () => {
      const result = await sendDraftToSelfAction(draft());
      setNotice(
        result.ok
          ? { tone: "ok", text: "הטיוטה נשלחה אליך. בדקי את התיבה." }
          : { tone: "bad", text: result.error }
      );
    });
  }

  return (
    /*
      בונים מימין, רואים משמאל. עד עכשיו הדרך היחידה לדעת מה יוצא הייתה
      "שלח טיוטה לעצמי" — לצאת מהמסך, לפתוח תיבת דואר, ולחזור.

      sticky על התצוגה: העורך ארוך יותר ממנה, וגלילה למטה כדי לערוך בלוק
      שלישי לא אמורה להעלים את מה שבודקים.
    */
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
      {/* ── קהל ─────────────────────────────────────────────────────── */}
      <section className="card flex flex-col p-0">
        <div className="card-h">
          <span
            className="glyph"
            style={
              { "--glyph-color": "var(--nav-coral)", "--glyph-bg": "var(--nav-coral-soft)" } as CSSProperties
            }
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9.5" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <h2>למי זה יוצא</h2>
          <span className="flex-1" />
          <span
            className="pill"
            style={
              { "--pill-color": "var(--nav-coral)", "--pill-bg": "var(--nav-coral-soft)" } as CSSProperties
            }
          >
            {audienceCount} נמענים
          </span>
        </div>

        {/*
          שורות ולא שבבים. שבב אומר "נבחר / לא נבחר"; כאן צריך גם לראות כמה
          כל סטטוס מוסיף, וכשהמספרים יושבים בטור אפשר להשוות ביניהם במבט.
        */}
        <div className="card-b flex flex-col gap-1.5">
          <AudienceRow
            label="כל אנשי הקשר"
            count={allCount}
            on={selected.length === 0}
            onToggle={() => setSelected([])}
          />
          {statusOptions.map((option) => (
            <AudienceRow
              key={option.name}
              label={statusLabel(option.name)}
              count={option.count}
              on={selected.includes(option.name)}
              onToggle={() =>
                setSelected((current) =>
                  current.includes(option.name)
                    ? current.filter((n) => n !== option.name)
                    : [...current, option.name]
                )
              }
            />
          ))}
          <p className="mt-1.5 text-[11.5px] text-[var(--subtle)]">
            הספירות כוללות רק מי שיש לו כתובת מייל ולא הוסר מרשימת התפוצה.
          </p>
        </div>
      </section>

      {/* ── נושא ────────────────────────────────────────────────────── */}
      <section className="card">
        <label className="field-label">
          נושא המייל
          <input
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="מה כתוב בשורת הנושא בתיבה של הנמענת"
          />
        </label>
      </section>

      {/* ── תוכן ────────────────────────────────────────────────────── */}
      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title">התוכן</h2>
          <div className="flex flex-wrap gap-1">
            {(["text", "image", "youtube"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className="btn-secondary"
                onClick={() => setBlocks((current) => [...current, emptyBlock(type)])}
              >
                + {BLOCK_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {blocks.map((block, index) => (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)]/50 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--subtle)]">
                {BLOCK_LABELS[block.type]}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="הזזה מעלה"
                  disabled={index === 0}
                  onClick={() => moveBlock(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="הזזה מטה"
                  disabled={index === blocks.length - 1}
                  onClick={() => moveBlock(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}
                >
                  מחיקה
                </button>
              </div>
            </div>

            {block.type === "text" && (
              <>
                <textarea
                  className="input"
                  rows={5}
                  value={block.html}
                  onChange={(event) => patchBlock(index, { html: event.target.value })}
                  placeholder="מה שרוצים לכתוב. שורה ריקה = פסקה חדשה."
                />
                <p className="text-xs text-[var(--subtle)]">
                  אפשר לשתול: {PLACEHOLDERS.join(" · ")}
                </p>
              </>
            )}

            {block.type === "image" &&
              (block.url ? (
                <div className="flex flex-col gap-2">
                  <Image
                    src={block.url}
                    alt={block.alt || "תמונה בניוזלטר"}
                    width={544}
                    height={306}
                    className="rounded-lg"
                    style={{ width: "100%", height: "auto" }}
                  />
                  <label className="field-label">
                    תיאור התמונה (נקרא כשהתמונה לא נטענת)
                    <input
                      className="input"
                      value={block.alt}
                      onChange={(event) => patchBlock(index, { alt: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-ghost self-start"
                    onClick={() => patchBlock(index, { url: "" })}
                  >
                    החלפת התמונה
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="input"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadImage(index, file);
                  }}
                />
              ))}

            {block.type === "youtube" && (
              <div className="flex flex-col gap-2">
                <label className="field-label">
                  קישור לסרטון
                  <input
                    className="input"
                    dir="ltr"
                    defaultValue={
                      block.videoId ? `https://www.youtube.com/watch?v=${block.videoId}` : ""
                    }
                    placeholder="https://www.youtube.com/watch?v=..."
                    onChange={(event) =>
                      patchBlock(index, { videoId: youtubeIdFrom(event.target.value) ?? "" })
                    }
                  />
                </label>
                {block.videoId ? (
                  <Image
                    src={`https://img.youtube.com/vi/${block.videoId}/hqdefault.jpg`}
                    alt="תצוגה מקדימה של הסרטון"
                    width={480}
                    height={360}
                    className="rounded-lg"
                    style={{ width: "100%", maxWidth: 320, height: "auto" }}
                  />
                ) : (
                  <p className="text-xs text-[var(--danger)]">
                    עוד לא זוהה סרטון בקישור הזה.
                  </p>
                )}
                <label className="field-label">
                  כיתוב מתחת לסרטון
                  <input
                    className="input"
                    value={block.caption}
                    onChange={(event) => patchBlock(index, { caption: event.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* ── שליחה ───────────────────────────────────────────────────── */}
      <section className="card flex flex-col gap-3">
        {scheduling && (
          <div className="flex flex-wrap gap-3">
            <label className="field-label">
              תאריך
              <input
                type="date"
                className="input"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="field-label">
              שעה
              <input
                type="time"
                className="input"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!scheduling && (
            <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
              שלח עכשיו ל-{audienceCount} נמענים
            </button>
          )}
          {scheduling ? (
            <>
              <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
                תזמן ל-{audienceCount} נמענים
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setScheduling(false)}
                disabled={pending}
              >
                ביטול התזמון
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setScheduling(true)}
              disabled={pending}
            >
              תזמן למועד אחר
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={pending} onClick={sendToSelf}>
            שלח טיוטה לעצמי
          </button>
        </div>

        {/*
          "שלח עכשיו" אינו שולח מהדפדפן: הוא מתזמן להרגע הזה, והקרון (שרץ כל
          רבע שעה) מוציא בפועל. זה מה שמאפשר לשליחה ל-200 איש להתפרס על כמה
          ריצות בלי טיימאאוט.
        */}
        <p className="text-xs text-[var(--subtle)]">
          השליחה יוצאת דרך המתזמן, שרץ כל רבע שעה — &rdquo;שלח עכשיו&rdquo; נכנס לתור הקרוב.
        </p>

        {notice && (
          <p
            className={`text-sm ${notice.tone === "ok" ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}
          >
            {notice.text}
          </p>
        )}
      </section>
      </div>

      <section className="card flex flex-col gap-3 p-0 lg:sticky lg:top-4">
        <div className="card-h">
          <span
            className="glyph"
            style={
              { "--glyph-color": "var(--nav-coral)", "--glyph-bg": "var(--nav-coral-soft)" } as CSSProperties
            }
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="4.5" width="20" height="15" rx="2" />
              <path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7" />
            </svg>
          </span>
          <h2>תצוגה מקדימה</h2>
          <span className="flex-1" />
          <span className="pill">{blocks.length} בלוקים</span>
        </div>
        <div className="card-b">
          <NewsletterPreview subject={subject} blocks={blocks} from={from} />
        </div>
      </section>
    </div>
  );
}

/** שורת קהל אחת: סימון, שם, וכמה הוא מוסיף. */
function AudienceRow({
  label,
  count,
  on,
  onToggle,
}: {
  label: string;
  count: number;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-start text-[12.5px] transition-colors duration-150"
      style={
        on
          ? {
              borderColor: "color-mix(in srgb, var(--primary) 40%, transparent)",
              backgroundColor: "var(--primary-soft)",
            }
          : { borderColor: "var(--border)", backgroundColor: "var(--surface)" }
      }
    >
      <span
        aria-hidden
        className="grid size-[15px] shrink-0 place-items-center rounded border-[1.5px]"
        style={
          on
            ? { borderColor: "var(--primary)", backgroundColor: "var(--primary)" }
            : { borderColor: "var(--border-strong)" }
        }
      >
        {on && (
          <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="var(--on-primary)" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
        )}
      </span>
      <b className={`min-w-0 flex-1 truncate ${on ? "font-semibold text-[var(--primary)]" : "font-medium"}`}>
        {label}
      </b>
      <span className={`data text-[11.5px] ${on ? "text-[var(--primary)]" : "text-[var(--subtle)]"}`}>
        {count}
      </span>
    </button>
  );
}
