-- ── בלמי הוואטסאפ לגשר הלא רשמי ────────────────────────────────────────────
--
-- מ-24.11.2026 הוואטסאפ יוצא דרך גשר לא רשמי (Baileys, whatsapp-bridge/)
-- ממספר חדש. הסיכון חזר להיות מה שהיה בימי Green API: לא חשבונית אלא
-- **חסימה**. מכאן שלושה בלמים חדשים, ושלושתם וואטסאפ בלבד:
--
--   whatsapp_paused — עצירה של הוואטסאפ האוטומטי בלבד. paused הקיים נשאר
--                     המתג הכללי (גם מייל וניוזלטר), ויושב בהגדרות.
--   min/max_gap_seconds — רווח אקראי בין הודעות אוטומטיות. הגשר מחזיק תור
--                     ושולח ממנו בקצב הזה; רצף במרווחים זהים הוא חתימה
--                     של אוטומציה. (0011 מחקה את min/max_delay_seconds,
--                     שהיו לאותה מטרה, כשעברנו לערוץ הרשמי.)
--   warmup_*        — שבוע חימום: התקרה מתחילה ב-15 ועולה בהדרגה עד
--                     daily_limit ביום השביעי. מספר חדש ששולח 40 ביום
--                     הראשון הוא מספר שנחסם.
--
-- warmup_started_at מתחיל מרגע ההרצה — כלומר מהיום שבו המספר החדש חובר.

alter table whatsapp_settings
  add column if not exists whatsapp_paused boolean not null default false,
  add column if not exists min_gap_seconds integer not null default 20
    check (min_gap_seconds between 0 and 600),
  add column if not exists max_gap_seconds integer not null default 60
    check (max_gap_seconds between 0 and 600),
  add column if not exists warmup_enabled boolean not null default true,
  add column if not exists warmup_started_at timestamptz default now();

alter table whatsapp_settings drop constraint if exists whatsapp_settings_gap_order;
alter table whatsapp_settings
  add constraint whatsapp_settings_gap_order check (max_gap_seconds >= min_gap_seconds);
