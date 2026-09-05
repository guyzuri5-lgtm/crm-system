"use client";

import Link from "next/link";
import { useState } from "react";
import { Conversation, type ConversationMessage } from "@/components/conversation";
import { ReplyBox, type ReplyResult, type ReplyTemplate } from "@/components/reply-box";
import { ScrollToBottom } from "@/components/scroll-to-bottom";
import { WindowMeter } from "@/components/window-meter";
import { Avatar } from "@/components/avatar";
import { formatDateTime } from "@/lib/dates";
import type { InteractionType } from "@/lib/supabase/database.types";

/**
 * שורה אחת ברשימת "לקוחות פעילים" — דקה כשהיא סגורה, שיחה מלאה כשהיא פתוחה.
 *
 * השורה בנויה כפריט ברשימת שיחות ולא ככרטיס: אווטר, שם, מה הוא עשה, שורית
 * מההודעה, ומצד שני הזמן ומד החלון. עשרים אנשים נכנסים למסך אחד, וסריקה
 * בעין לא דורשת גלילה.
 *
 * מד החלון הוא העיקר כאן. הוא המכשיר שמראה כמה זמן נשאר לענות בטקסט חופשי,
 * והמקום הנכון שלו הוא בכל שורה ולא רק בתוך השיחה הפתוחה — ההחלטה למי לענות
 * קודם מתקבלת בזמן סריקת הרשימה.
 *
 * השיחה נטענת רק בפתיחה הראשונה. הרשימה מגיעה עם 200 שורות, ולטעון מראש את
 * ההיסטוריה של כולן זה להוריד מגה-בייטים שאיש לא ביקש לראות.
 */

export interface ActiveRowData {
  contactId: string;
  name: string;
  phone: string | null;
  email: string | null;
  statusName: string | null;
  /** מחלקות Tailwind מוכנות מהשרת — הן חייבות להיות מחרוזות שלמות בקוד. */
  statusClasses: string;
  /** מה קרה — "שלח הודעה", "נרשמה לאירוע". */
  summaryLabel: string;
  /** סוג האינטראקציה, לבחירת האייקון שליד התווית. */
  activityType: InteractionType | null;
  /** מתי, בניסוח יחסי — "לפני 9 דק׳". */
  timeLabel: string;
  preview: string | null;
  openWindow: boolean;
  hoursLeft: number;
  /** הדבר האחרון שקרה הגיע מהלקוח — כלומר טרם נענה. */
  unanswered: boolean;
  inboundCount: number;
  canSend: boolean;
  notes: string | null;
  createdAt: string;
  lastIncomingAt: string | null;
  whatsappId: string | null;
}

/* ── אייקוני הפעולה ─────────────────────────────────────────────────────── */
/* קטנים ודהויים: הם מלווים את התווית ולא מחליפים אותה. */

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const ACTIVITY_ICONS: Record<InteractionType, React.ReactNode> = {
  whatsapp_in: (
    <Svg>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
    </Svg>
  ),
  whatsapp_out: (
    <Svg>
      <path d="M21 3 3 10.5l7 3 3 7z" />
      <path d="m10 13.5 4.5-4.5" />
    </Svg>
  ),
  email_out: (
    <Svg>
      <rect x="2" y="4.5" width="20" height="15" rx="2" />
      <path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7" />
    </Svg>
  ),
  quiz_submitted: (
    <Svg>
      <path d="M4 4h16v12l-4 4H4z" />
      <path d="M20 16h-4v4M8 9h8M8 13h4" />
    </Svg>
  ),
  manual_note: (
    <Svg>
      <path d="M4 4h16v12l-4 4H4z" />
      <path d="M20 16h-4v4M8 9h8M8 13h4" />
    </Svg>
  ),
  course_lead: (
    <Svg>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </Svg>
  ),
  course_registered: (
    <Svg>
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </Svg>
  ),
  event_registered: (
    <Svg>
      <path d="M2 9.5a3 3 0 0 1 0 6V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2.5a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
      <path d="M13 5.5v13" />
    </Svg>
  ),
  booking_created: (
    <Svg>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M16 2.5v4M8 2.5v4M3 10h18" />
    </Svg>
  ),
  booking_cancelled: (
    <Svg>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M16 2.5v4M8 2.5v4M3 10h18" />
      <path d="m9.5 14.5 5 4M14.5 14.5l-5 4" />
    </Svg>
  ),
};

type ThreadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; messages: ConversationMessage[] }
  | { status: "error"; error: string };

export function ContactRow({
  row,
  templates,
  onSend,
}: {
  row: ActiveRowData;
  templates: ReplyTemplate[];
  onSend: (formData: FormData) => Promise<ReplyResult>;
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ThreadState>({ status: "idle" });

  async function loadThread() {
    setThread({ status: "loading" });
    try {
      const response = await fetch(`/api/contacts/${row.contactId}/thread`);
      if (!response.ok) {
        throw new Error(
          response.status === 401 ? "פג תוקף ההתחברות — רעננו את העמוד" : "טעינת השיחה נכשלה"
        );
      }
      const data = (await response.json()) as { messages: ConversationMessage[] };
      setThread({ status: "ready", messages: data.messages });
    } catch (err) {
      setThread({ status: "error", error: err instanceof Error ? err.message : "טעינת השיחה נכשלה" });
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // רק בפתיחה הראשונה. סגירה ופתיחה חוזרת לא אמורות לשלוח בקשה נוספת.
    if (next && thread.status === "idle") void loadThread();
  }

  const panelId = `thread-${row.contactId}`;

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-unanswered={row.unanswered ? "true" : undefined}
        className="inbox-row flex w-full items-center gap-3 px-4 py-3 text-start transition-colors"
      >
        <Avatar name={row.name} />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13.5px] font-semibold">{row.name}</span>
            {row.statusName && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${row.statusClasses}`}
              >
                {row.statusName}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap text-[var(--subtle)]">
              {row.activityType && ACTIVITY_ICONS[row.activityType]}
              {row.summaryLabel}
            </span>
          </span>

          {/* שורית ההודעה, ובהיעדרה הטלפון — כדי שהשורה תישאר בגובה אחיד
              ותמשיך לומר משהו גם למי שמעולם לא כתב בוואטסאפ. */}
          {row.preview ? (
            <span className="truncate text-[12.5px] text-[var(--muted)]">{row.preview}</span>
          ) : row.phone ? (
            <span className="data truncate text-[12px] text-[var(--subtle)]" dir="ltr">
              {row.phone}
            </span>
          ) : (
            <span className="text-[12.5px] text-[var(--subtle)]">—</span>
          )}
        </span>

        {/* בעמודת RTL הקצה הלוגי הוא שמאל, ולכן items-end מיישר החוצה. */}
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="data text-[11px] whitespace-nowrap text-[var(--subtle)]">
            {row.timeLabel}
          </span>
          <WindowMeter openWindow={row.openWindow} hoursLeft={row.hoursLeft} />
        </span>

        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-[var(--subtle)] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className="border-t border-[var(--border)]"
          style={{ backgroundColor: "var(--background)" }}
        >
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-w-0 flex-col gap-3">
              <ScrollToBottom
                watch={thread.status === "ready" ? thread.messages.length : 0}
                className="max-h-96 overflow-y-auto rounded-xl bg-[var(--surface-sunken)] p-3"
              >
                {thread.status === "loading" && (
                  <p className="py-6 text-center text-sm text-[var(--subtle)]">טוען שיחה...</p>
                )}
                {thread.status === "error" && (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <p className="text-sm text-[var(--danger)]">{thread.error}</p>
                    <button type="button" onClick={loadThread} className="btn-ghost">
                      נסה שוב
                    </button>
                  </div>
                )}
                {thread.status === "ready" && <Conversation messages={thread.messages} />}
              </ScrollToBottom>

              <ReplyBox
                contactId={row.contactId}
                canSend={row.canSend}
                openWindow={row.openWindow}
                hoursLeft={row.hoursLeft}
                templates={templates}
                onSend={onSend}
              />
            </div>

            <div className="flex flex-col gap-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
                <dt className="text-[var(--muted)]">טלפון</dt>
                <dd className="data truncate" dir="ltr">
                  {row.phone ?? "—"}
                </dd>
                <dt className="text-[var(--muted)]">מייל</dt>
                <dd className="data truncate" dir="ltr">
                  {row.email ?? "—"}
                </dd>
                <dt className="text-[var(--muted)]">הודעה נכנסת אחרונה</dt>
                <dd className="data">{formatDateTime(row.lastIncomingAt)}</dd>
                <dt className="text-[var(--muted)]">הודעות נכנסות</dt>
                <dd className="tabular">{row.inboundCount}</dd>
                <dt className="text-[var(--muted)]">נוצר</dt>
                <dd className="data">{formatDateTime(row.createdAt)}</dd>
              </dl>

              {row.notes && (
                <div
                  className="rounded-xl p-3 ring-1 ring-inset ring-[var(--border)]"
                  style={{ backgroundColor: "var(--surface)" }}
                >
                  <p className="mb-1 text-xs font-medium text-[var(--muted)]">הערות</p>
                  <p className="text-sm whitespace-pre-wrap">{row.notes}</p>
                </div>
              )}

              <Link href={`/contacts/${row.contactId}`} className="btn-secondary justify-center">
                לכרטיס המלא ולעריכה
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
