/**
 * סימון שהפגישה מתקיימת ב-Google Meet.
 *
 * שתי וריאציות מאותו רכיב: "card" לפס ההסבר המלא בראש דף ההזמנה ובכרטיס
 * הסיכום, ו-"chip" לתגית קומפקטית בשורת הפרטים. הלוגו מצויר inline כדי שלא
 * תהיה תלות ברשת חיצונית בדף שנטען אצל הלקוח.
 */

export function GoogleMeetLogo({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 87 72" className={className} aria-hidden focusable="false">
      <path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z" />
      <path fill="#0066da" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z" />
      <path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z" />
      <path fill="#2684fc" d="M20.5 20.5H0v31h20.5z" />
      <path
        fill="#00ac47"
        d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5H20.5V72h43c3.315 0 6-2.685 6-6V53.08z"
      />
      <path fill="#ffba00" d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z" />
    </svg>
  );
}

export function GoogleMeetChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)] ring-1 ring-inset ring-[var(--border-strong)]">
      <GoogleMeetLogo className="size-3.5" />
      Google Meet
    </span>
  );
}

export function GoogleMeetCard({ note }: { note?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      {/* הלוח הבהיר היחיד שנשאר: הלוגו של גוגל צבעוני ודורש רקע בהיר.
          הכרטיס עצמו עבר למשטחי המערכת — הוא היה לבן קבוע, ושורת ההסבר
          שבו לקחה את צבעה מ---muted, כלומר אפור בהיר על לבן במצב כהה (2.38). */}
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-[#f1f3f4]">
        <GoogleMeetLogo className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          הפגישה תתקיים בשיחת וידאו ב-<span dir="ltr">Google Meet</span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
          {note ?? "קישור לשיחה יישלח אליכם במייל ויתווסף להזמנה ביומן — אין צורך להתקין שום דבר."}
        </p>
      </div>
    </div>
  );
}
