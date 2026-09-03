"use client";

import Link from "next/link";
import { useState } from "react";
import { Conversation, type ConversationMessage } from "@/components/conversation";
import { ReplyBox, type ReplyResult, type ReplyTemplate } from "@/components/reply-box";
import { ScrollToBottom } from "@/components/scroll-to-bottom";

/**
 * שורה אחת ברשימת "לקוחות פעילים" — דקה כשהיא סגורה, שיחה מלאה כשהיא פתוחה.
 *
 * מה שהיה כאן קודם היה כרטיס בגובה חמש שורות לכל איש קשר: שם, תגית, תיבת
 * הודעה, תגית חלון, ו-<details> לתשובה. עשרה אנשי קשר מילאו מסך, וסריקה של
 * הרשימה בעין דרשה גלילה. עכשיו השורה בנויה כמו פריט ברשימת שיחות: שם,
 * שורית מההודעה האחרונה, וזמן — ולחיצה פותחת את השאר.
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
  /** מתי, בניסוח יחסי — "לפני 9 דק׳". */
  timeLabel: string;
  preview: string | null;
  openWindow: boolean;
  hoursLeft: number;
  inboundCount: number;
  canSend: boolean;
  notes: string | null;
  createdAt: string;
  lastIncomingAt: string | null;
  whatsappId: string | null;
}

type ThreadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; messages: ConversationMessage[] }
  | { status: "error"; error: string };

const TZ = "Asia/Jerusalem";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { timeZone: TZ });
}

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
    <div
      className={`overflow-hidden rounded-xl border bg-white transition-colors ${
        open ? "border-[var(--border-strong)]" : "border-[var(--border)]"
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-start transition-colors hover:bg-[var(--background)]"
      >
        {/* נקודת מצב החלון — במבט אחד, בלי לקרוא מילה. */}
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${
            row.openWindow ? "bg-emerald-500" : "bg-stone-300"
          }`}
        />

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{row.name}</span>
            {row.statusName && (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${row.statusClasses}`}
              >
                {row.statusName}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-[var(--muted)]">
            {row.preview || row.summaryLabel}
          </span>
        </span>

        <span className="shrink-0 text-xs text-[var(--subtle)]">{row.timeLabel}</span>

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
        <div id={panelId} className="border-t border-[var(--border)] bg-[var(--background)]/40">
          <div className="grid gap-4 p-3.5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-w-0 flex-col gap-3">
              <ScrollToBottom
                watch={thread.status === "ready" ? thread.messages.length : 0}
                className="max-h-96 overflow-y-auto rounded-xl bg-[var(--background)] p-3"
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
                <dd className="truncate" dir="ltr">
                  {row.phone ?? "—"}
                </dd>
                <dt className="text-[var(--muted)]">מייל</dt>
                <dd className="truncate" dir="ltr">
                  {row.email ?? "—"}
                </dd>
                <dt className="text-[var(--muted)]">הודעה נכנסת אחרונה</dt>
                <dd>{formatDateTime(row.lastIncomingAt)}</dd>
                <dt className="text-[var(--muted)]">הודעות נכנסות</dt>
                <dd>{row.inboundCount}</dd>
                <dt className="text-[var(--muted)]">נוצר</dt>
                <dd>{formatDateTime(row.createdAt)}</dd>
              </dl>

              {row.notes && (
                <div className="rounded-xl bg-white p-3 ring-1 ring-inset ring-[var(--border)]">
                  <p className="mb-1 text-xs font-medium text-[var(--muted)]">הערות</p>
                  <p className="whitespace-pre-wrap text-sm">{row.notes}</p>
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
