import type { CSSProperties, ReactNode } from "react";

/* ── אייקונים ───────────────────────────────────────────────────────────── */
/* קו בעובי אחיד, 24×24. הגודל נקבע בכל אתר קריאה, כי אותו אייקון מופיע
   בריבוע של 24 פיקסלים בכרטיס מדד ובריבוע של 32 בשורת המצב. */

function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Users = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const Calendar = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2.5v4M8 2.5v4M3 10h18" />
  </Svg>
);

export const Route = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="5" r="3" />
    <path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H12" />
  </Svg>
);

export const Ticket = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M2 9.5a3 3 0 0 1 0 6V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2.5a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
    <path d="M13 5.5v13" />
  </Svg>
);

export const Clock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.3l3.2 2" />
  </Svg>
);

export const Alert = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17.2h.01" />
  </Svg>
);

export const Chat = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </Svg>
);

export const School = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M22 10v6" />
    <path d="M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </Svg>
);

/** ריבוע אייקון צבעוני — שני אסימונים, בלי לחזור על שתי השורות בכל קריאה. */
export function glyphStyle(color: string, soft: string): CSSProperties {
  return { "--glyph-color": color, "--glyph-bg": soft } as CSSProperties;
}

/** תווית רכה בגוון — אותו דבר לספירות שיושבות בכותרות ובשורות קבוצה. */
export function pillStyle(color: string, soft: string): CSSProperties {
  return { "--pill-color": color, "--pill-bg": soft } as CSSProperties;
}
