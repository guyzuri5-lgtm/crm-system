"use client";

import type { NewsletterBlock } from "@/lib/supabase/database.types";

/**
 * תצוגה מקדימה חיה של המייל, לצד העורך.
 *
 * עד עכשיו הדרך היחידה לראות מה יוצא הייתה "שלח טיוטה לעצמי" — כלומר לצאת
 * מהמסך, לפתוח תיבת דואר, ולחזור. כאן זה מתעדכן עם כל הקלדה.
 *
 * **נאמנות, לא זהות.** המייל האמיתי נבנה ב-renderNewsletterHtml בשרת עם
 * טבלאות ו-inline styles, כי זה מה שלקוחות דואר מבינים. כאן מצוירת אותה
 * תוצאה בדפדפן: אותו רוחב 600, אותו רקע לבן על נייר, אותם מרווחים בין
 * בלוקים, ואותה שורת הסרה בתחתית. מה שלא ניתן להראות — איך ג׳ימייל יחתוך
 * את זה במובייל — נשאר בגדר "שלח טיוטה לעצמי".
 */

/** רוחב התוכן במייל, זהה ל-CONTENT_WIDTH שבשרת. */
const MAIL_WIDTH = 600;

export function NewsletterPreview({
  subject,
  blocks,
  from,
}: {
  subject: string;
  blocks: NewsletterBlock[];
  from?: string;
}) {
  const empty = !subject.trim() && !blocks.length;

  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl border p-4"
      style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
    >
      {from && (
        <p className="data text-[10.5px] text-[var(--subtle)]" dir="ltr">
          from: {from}
        </p>
      )}

      {empty ? (
        <p className="py-10 text-center text-sm text-[var(--subtle)]">
          מה שתכתבי יופיע כאן, בדיוק כפי שהוא ייראה בתיבה.
        </p>
      ) : (
        <div
          className="mx-auto w-full overflow-hidden rounded-xl px-6 py-6"
          style={{
            maxWidth: MAIL_WIDTH,
            backgroundColor: "var(--surface)",
            boxShadow: "var(--shadow-1)",
          }}
        >
          {subject.trim() && (
            <h4
              className="mb-4 text-[17px] leading-snug font-medium tracking-[-0.02em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {subject}
            </h4>
          )}

          {blocks.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}

          <p
            className="mt-5 border-t pt-3 text-center text-[10px] leading-relaxed"
            style={{ borderColor: "var(--border)", color: "var(--subtle)" }}
          >
            קיבלת את המייל כי נרשמת אצל גיא · להסרה מרשימת התפוצה
          </p>
        </div>
      )}
    </div>
  );
}

function BlockView({ block }: { block: NewsletterBlock }) {
  switch (block.type) {
    case "text":
      // שורה ריקה בעורך היא פסקה חדשה במייל (‎\n → <br> בשרת). whitespace-pre-line
      // משחזר בדיוק את זה בלי לפרסר HTML, וכך גם אין כאן נתיב להזרקה.
      return (
        <p className="mb-4 text-[15px] leading-relaxed whitespace-pre-line last:mb-0">
          {block.html || <span className="text-[var(--subtle)]">פסקה ריקה</span>}
        </p>
      );

    case "image":
      return block.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- כתובת חיצונית שהמשתמשת מזינה; אין דומיין ידוע מראש ל-next/image
        <img
          src={block.url}
          alt={block.alt}
          className="mb-4 block w-full rounded-xl last:mb-0"
        />
      ) : (
        <Placeholder label="תמונה — עוד אין כתובת" />
      );

    case "youtube":
      return block.videoId ? (
        <figure className="mb-4 last:mb-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- תמונת התצוגה של יוטיוב, בדיוק כמו במייל עצמו */}
          <img
            src={`https://img.youtube.com/vi/${block.videoId}/hqdefault.jpg`}
            alt={block.caption || "צפייה בסרטון"}
            className="block w-full rounded-xl"
          />
          {block.caption && (
            <figcaption className="mt-2 text-[13px] text-[var(--muted)]">{block.caption}</figcaption>
          )}
        </figure>
      ) : (
        <Placeholder label="סרטון — עוד אין מזהה" />
      );
  }
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      className="mb-4 grid h-20 place-items-center rounded-xl border border-dashed text-[12px] last:mb-0"
      style={{ borderColor: "var(--border-strong)", color: "var(--subtle)" }}
    >
      {label}
    </div>
  );
}
