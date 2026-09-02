import type { StatusColor } from "@/lib/status-colors";

// Hand-written to match supabase/migrations/0001_init.sql (+ 0002, 0003).
//
// Once the project is linked to a real Supabase project, regenerate this from the
// live schema instead of hand-editing it further:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts

// הסטטוסים אינם עוד רשימה קשיחה: מ-0003_statuses.sql הם שורות בטבלת
// contact_statuses שהצוות מנהל מהדשבורד, ו-contacts.status הוא text עם מפתח זר
// לשם הסטטוס. לכן זה string ולא איחוד ליטרלים — הוולידציה עברה מהטיפוסים
// לזמן ריצה, מול בסיס הנתונים (ראו src/lib/statuses.ts).
export type ContactStatus = string;

/** סוגי קלט לשדה איש קשר — נאכפים גם ב-check constraint ב-0006_fields.sql */
export const FIELD_INPUT_TYPES = [
  "text",
  "longtext",
  "number",
  "date",
  "email",
  "phone",
  "url",
] as const;
export type FieldInputType = (typeof FIELD_INPUT_TYPES)[number];

/** builtin = עמודה אמיתית ב-contacts | custom = מפתח בתוך contacts.custom */
export type FieldKind = "builtin" | "custom";

export type InteractionType =
  | "whatsapp_in"
  | "whatsapp_out"
  | "email_out"
  | "manual_note"
  // נוסף ב-0002_quiz.sql — נרשם ביומן איש הקשר כשמישהו ממלא את שאלון הצ'אקרות
  | "quiz_submitted"
  // נוספו ב-0005_booking.sql — קביעת פגישה וביטולה
  | "booking_created"
  | "booking_cancelled"
  // נוסף ב-0013_course_leads.sql — השארת פרטים בדף הנחיתה של קורס המדיטציה
  | "course_lead";

/** סוגי רשומה בשאלון, לפי סדר עולה של "חום" הליד */
export const QUIZ_KINDS = ["anonymous", "lead", "booking_click"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  anonymous: "אנונימי",
  lead: "השאיר פרטים",
  booking_click: "יצא לקבוע פגישה",
};

/** סוגי רשומה בדף הנחיתה של הקורס, לפי סדר עולה של "חום" הליד */
export const COURSE_LEAD_KINDS = ["lead", "payment_click"] as const;
export type CourseLeadKind = (typeof COURSE_LEAD_KINDS)[number];

export const COURSE_LEAD_KIND_LABELS: Record<CourseLeadKind, string> = {
  lead: "השאיר פרטים",
  payment_click: "יצא לתשלום",
};

/** מה מכניס איש קשר למסע. כולם ניתנים לזיהוי בשאילתה מהקרון. */
export const JOURNEY_ENTRY_TYPES = ["status", "quiz", "booking", "course_lead"] as const;
export type JourneyEntryType = (typeof JOURNEY_ENTRY_TYPES)[number];

export const JOURNEY_ENTRY_LABELS: Record<JourneyEntryType, string> = {
  status: "נכנס לסטטוס",
  quiz: "מילא את השאלון",
  booking: "קבע פגישה",
  course_lead: "השאיר פרטים בדף הקורס",
};

/**
 * האם השלב רץ. עם stop_on_reply כבוי, שני שלבים עוקבים עם תנאים הפוכים הם
 * שני מסלולים — וזו ההסתעפות.
 */
/**
 * ממה נמדד הזמן של כרטיסייה בודדת.
 *
 * שלושה ולא שניים, כי "בוקר של הפגישה" אינו מרחק ממנה אלא שעה ביום: לפגישה
 * ב-15:00 הבוקר הוא שש שעות לפני, ולפגישה ב-11:00 שעתיים.
 */
export const STEP_TIMINGS = ["relative", "booking_offset", "booking_day_at"] as const;
export type StepTiming = (typeof STEP_TIMINGS)[number];

export const STEP_TIMING_LABELS: Record<StepTiming, string> = {
  relative: "אחרי הכרטיסייה שלפניה",
  booking_offset: "מרחק מהפגישה",
  booking_day_at: "שעה ביום, סביב הפגישה",
};

export const JOURNEY_CONDITIONS = ["always", "if_replied", "if_not_replied"] as const;
export type JourneyCondition = (typeof JOURNEY_CONDITIONS)[number];

export const JOURNEY_CONDITION_LABELS: Record<JourneyCondition, string> = {
  always: "תמיד",
  if_replied: "רק אם ענה",
  if_not_replied: "רק אם לא ענה",
};

export const JOURNEY_STATES = [
  "active",
  "completed",
  "stopped_replied",
  "stopped_manual",
] as const;
export type JourneyState = (typeof JOURNEY_STATES)[number];

export const JOURNEY_STATE_LABELS: Record<JourneyState, string> = {
  active: "במסע",
  completed: "סיים",
  stopped_replied: "נעצר — ענה",
  stopped_manual: "נעצר ידנית",
};

export const BOOKING_LOCATIONS = ["google_meet", "phone", "in_person"] as const;
export type BookingLocation = (typeof BOOKING_LOCATIONS)[number];

export const BOOKING_LOCATION_LABELS: Record<BookingLocation, string> = {
  google_meet: "Google Meet",
  phone: "שיחת טלפון",
  in_person: "פגישה פרונטלית",
};

export const BOOKING_STATUSES = ["confirmed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const MESSAGE_CHANNELS = ["email", "whatsapp"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const AUTOMATION_TRIGGER_TYPES = ["status_change", "time_since_no_reply"] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export interface StatusChangeTriggerValue {
  from_status?: ContactStatus;
}

export interface TimeSinceNoReplyTriggerValue {
  days: number;
  status: ContactStatus;
}

// Every table needs Row/Insert/Update/Relationships (the last one just `[]` here,
// since we never rely on supabase-js auto-resolving embedded-select types — the two
// places that embed a relation, in automation-engine.ts, use an explicit
// `.returns<T>()` cast instead) and the schema needs Views/Functions, even if empty,
// or supabase-js's generic resolution silently collapses every table's types to
// `never`. This mirrors what `supabase gen types` itself emits — see
// @supabase/postgrest-js's GenericTable/GenericSchema.
type Relationships = [];

export type Database = {
  public: {
    Tables: {
      contacts: {
        Row: {
          id: string;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          status: ContactStatus;
          source: string;
          tags: string[];
          /** wa_id של Meta — המספר בפורמט בינלאומי בלי +, "972501234567" */
          whatsapp_id: string | null;
          last_incoming_message_at: string | null;
          notes: string | null;
          /** ערכי השדות המותאמים, ממופתחים לפי contact_fields.key */
          custom: Record<string, string>;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
        Relationships: Relationships;
      };
      contact_fields: {
        Row: {
          id: string;
          key: string;
          label: string;
          kind: FieldKind;
          input_type: FieldInputType;
          sort_order: number;
          show_in_table: boolean;
          editable: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contact_fields"]["Row"]> & {
          key: string;
          label: string;
          kind: FieldKind;
        };
        Update: Partial<Database["public"]["Tables"]["contact_fields"]["Row"]>;
        Relationships: Relationships;
      };
      contact_statuses: {
        Row: {
          id: string;
          name: string;
          color: StatusColor;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contact_statuses"]["Row"]> & {
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["contact_statuses"]["Row"]>;
        Relationships: Relationships;
      };
      quiz_submissions: {
        Row: {
          id: string;
          session_id: string;
          contact_id: string | null;
          kind: QuizKind;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          consent: boolean;
          lowest_chakra: string | null;
          lowest_chakra_name: string | null;
          scores: Record<string, number>;
          statuses: Record<string, string>;
          answers: { id: number; chakra: string; text: string; score: number | null }[];
          balance_index: number | null;
          balance_display: number | null;
          mean_score: number | null;
          spread: number | null;
          source: string | null;
          utm: Record<string, string>;
          booking_clicked_at: string | null;
          results_email_sent_at: string | null;
          submitted_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_submissions"]["Row"]> & {
          session_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_submissions"]["Row"]>;
        Relationships: Relationships;
      };
      course_leads: {
        Row: {
          id: string;
          session_id: string;
          contact_id: string | null;
          kind: CourseLeadKind;
          full_name: string | null;
          email: string | null;
          phone: string | null;
          consent: boolean;
          /** מתי ניתנה ההסכמה לדיוור. null כשלא אושרה — זו הראיה, ולכן לא נדרס בכל עדכון. */
          consent_at: string | null;
          source: string | null;
          utm: Record<string, string>;
          payment_clicked_at: string | null;
          submitted_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["course_leads"]["Row"]> & {
          session_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["course_leads"]["Row"]>;
        Relationships: Relationships;
      };
      interactions: {
        Row: {
          id: string;
          contact_id: string;
          type: InteractionType;
          content: string | null;
          /** idMessage של וואטסאפ, לדה-דופליקציה של webhooks. ריק לשורות פנימיות. */
          external_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["interactions"]["Row"]> & {
          contact_id: string;
          type: InteractionType;
        };
        Update: Partial<Database["public"]["Tables"]["interactions"]["Row"]>;
        Relationships: Relationships;
      };
      message_templates: {
        Row: {
          id: string;
          channel: MessageChannel;
          name: string;
          subject: string | null;
          body: string;
          /** שם התבנית כפי שאושרה ב-Meta. ריק = ניתנת לשליחה רק בתוך חלון 24 השעות. */
          meta_template_name: string | null;
          /** קוד השפה שאיתו אושרה ("he", "en_US"). חייב להתאים בדיוק. */
          meta_language_code: string;
          /** מה ממלא את {{1}}, {{2}} ... לפי הסדר, כמציינים של המערכת. */
          meta_variables: string[];
          /** נוספו ב-0015 — תמונת מצב מסונכרנת מ-Meta, לא מקור אמת */
          meta_template_id: string | null;
          /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED | MISSING */
          meta_status: string | null;
          meta_category: string | null;
          meta_rejected_reason: string | null;
          meta_synced_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["message_templates"]["Row"]> & {
          channel: MessageChannel;
          name: string;
          body: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_templates"]["Row"]>;
        Relationships: Relationships;
      };
      automation_rules: {
        Row: {
          id: string;
          trigger_type: AutomationTriggerType;
          trigger_value: StatusChangeTriggerValue | TimeSinceNoReplyTriggerValue;
          action_channel: MessageChannel;
          action_template_id: string;
          active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["automation_rules"]["Row"]> & {
          trigger_type: AutomationTriggerType;
          action_channel: MessageChannel;
          action_template_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["automation_rules"]["Row"]>;
        Relationships: Relationships;
      };
      team_members: {
        Row: {
          id: string;
          full_name: string | null;
          email: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["team_members"]["Row"]> & {
          id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Row"]>;
        Relationships: Relationships;
      };
      automation_rule_runs: {
        Row: {
          rule_id: string;
          contact_id: string;
          fired_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["automation_rule_runs"]["Row"]> & {
          rule_id: string;
          contact_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["automation_rule_runs"]["Row"]>;
        Relationships: Relationships;
      };
      whatsapp_settings: {
        Row: {
          id: boolean;
          /** תקרת תבניות יומית. בלם *עלות*: כל תבנית שנמסרת מחויבת על ידי Meta. */
          daily_limit: number;
          paused: boolean;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["whatsapp_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["whatsapp_settings"]["Row"]>;
        Relationships: Relationships;
      };
      booking_settings: {
        Row: {
          id: boolean;
          timezone: string;
          calendar_id: string;
          busy_calendar_ids: string[];
          brand_name: string;
          /** אירוע יום־שלם ביומן חוסם זמינות. ברירת המחדל: לא — ראו 0008. */
          block_all_day_events: boolean;
          host_name: string | null;
          host_title: string | null;
          /** כתובת ציבורית מלאה בבאקט booking-assets */
          host_photo_url: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["booking_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["booking_settings"]["Row"]>;
        Relationships: Relationships;
      };
      booking_event_types: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string | null;
          duration_minutes: number;
          buffer_before_minutes: number;
          buffer_after_minutes: number;
          min_notice_hours: number;
          max_days_ahead: number;
          slot_interval_minutes: number;
          location: BookingLocation;
          location_details: string | null;
          color: StatusColor;
          set_contact_status: string | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["booking_event_types"]["Row"]> & {
          slug: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_event_types"]["Row"]>;
        Relationships: Relationships;
      };
      booking_availability: {
        Row: {
          id: string;
          /** null = ברירת המחדל הגלובלית, שחלה על כל סוג פגישה בלי שעות משלו */
          event_type_id: string | null;
          /** 0 = ראשון */
          weekday: number;
          /** דקות מחצות, שעת קיר באזור הזמן שב-booking_settings */
          start_minute: number;
          end_minute: number;
        };
        Insert: Partial<Database["public"]["Tables"]["booking_availability"]["Row"]> & {
          weekday: number;
          start_minute: number;
          end_minute: number;
        };
        Update: Partial<Database["public"]["Tables"]["booking_availability"]["Row"]>;
        Relationships: Relationships;
      };
      booking_blackouts: {
        Row: {
          id: string;
          starts_at: string;
          ends_at: string;
          reason: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["booking_blackouts"]["Row"]> & {
          starts_at: string;
          ends_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_blackouts"]["Row"]>;
        Relationships: Relationships;
      };
      booking_date_overrides: {
        Row: {
          id: string;
          event_type_id: string | null;
          /** "YYYY-MM-DD" — תאריך, לא רגע בזמן */
          override_date: string;
          /** שניהם null = לא זמין באותו יום כלל */
          start_minute: number | null;
          end_minute: number | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["booking_date_overrides"]["Row"]> & {
          override_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_date_overrides"]["Row"]>;
        Relationships: Relationships;
      };
      bookings: {
        Row: {
          id: string;
          event_type_id: string;
          contact_id: string | null;
          starts_at: string;
          ends_at: string;
          status: BookingStatus;
          invitee_name: string;
          invitee_email: string;
          invitee_phone: string | null;
          invitee_notes: string | null;
          invitee_timezone: string;
          google_event_id: string | null;
          google_meet_url: string | null;
          cancel_token: string;
          cancelled_at: string | null;
          cancelled_by: "invitee" | "team" | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bookings"]["Row"]> & {
          event_type_id: string;
          starts_at: string;
          ends_at: string;
          invitee_name: string;
          invitee_email: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookings"]["Row"]>;
        Relationships: Relationships;
      };

      // ── נוספו ב-0016_journeys.sql ──────────────────────────────────────
      journeys: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          /** status | quiz | booking | course_lead */
          entry_type: JourneyEntryType;
          /** {"status": "..."} עבור entry_type=status */
          entry_value: { status?: string };
          active: boolean;
          /** נוסף ב-0017 — תגובה של הלקוח מסיימת את המסע כולו */
          stop_on_reply: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journeys"]["Row"]> & { name: string; entry_type: JourneyEntryType };
        Update: Partial<Database["public"]["Tables"]["journeys"]["Row"]>;
        Relationships: Relationships;
      };
      journey_steps: {
        Row: {
          id: string;
          journey_id: string;
          /** ימים להמתנה *לפני* השלב. הקרון רץ פעם ביום, ולכן יום הוא היחידה. */
          wait_days: number;
          /** נוסף ב-0021 — רק ל-relative: יישור לשעה ביום אחרי הוספת הימים. ריק = באותה שעה כמו הקודמת. */
          relative_at_minutes: number | null;
          channel: MessageChannel;
          template_id: string;
          /** דקות מ-starts_at של הפגישה. שלילי = לפני. */
          offset_minutes: number;
          /** נוספו ב-0020 — התזמון ירד מהמסע אל הכרטיסייה */
          timing: StepTiming;
          /** 0 = יום הפגישה, ‎-1 = היום שלפניו */
          day_offset: number;
          /** דקות מחצות בשעון הלקוח. 540 = 09:00 */
          day_at_minutes: number;
          /** נוספו ב-0019 — מיקום הכרטיסייה על המשטח */
          pos_x: number;
          pos_y: number;
          /** שם קצר לכרטיסייה; אותה תבנית יכולה להופיע בכמה מסלולים */
          label: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journey_steps"]["Row"]> & {
          journey_id: string;
          channel: MessageChannel;
          template_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["journey_steps"]["Row"]>;
        Relationships: Relationships;
      };
      journey_edges: {
        Row: {
          id: string;
          journey_id: string;
          /** ריק = יוצאת מנקודת הכניסה למסע */
          from_step_id: string | null;
          to_step_id: string;
          condition: JourneyCondition;
          /** סדר הבדיקה כשיוצאות כמה קשתות מאותו צומת. הראשונה שמתאימה זוכה. */
          priority: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journey_edges"]["Row"]> & {
          journey_id: string;
          to_step_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["journey_edges"]["Row"]>;
        Relationships: Relationships;
      };
      journey_enrollments: {
        Row: {
          id: string;
          journey_id: string;
          contact_id: string;
          /** ריק = טרם התחיל, או שהצומת נמחק */
          current_step_id: string | null;
          /** חגורת ביטחון נגד מעגלים בגרף */
          steps_taken: number;
          next_run_at: string;
          /** נוסף ב-0018 — הפגישה שאליה הצירוף קשור, במסע מעוגן-פגישה */
          booking_id: string | null;
          /** active | completed | stopped_replied | stopped_manual */
          state: JourneyState;
          enrolled_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journey_enrollments"]["Row"]> & {
          journey_id: string;
          contact_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["journey_enrollments"]["Row"]>;
        Relationships: Relationships;
      };
      journey_step_runs: {
        Row: {
          id: string;
          enrollment_id: string;
          step_id: string;
          sent_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["journey_step_runs"]["Row"]> & {
          enrollment_id: string;
          step_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["journey_step_runs"]["Row"]>;
        Relationships: Relationships;
      };
    };
    Views: {
      /** נוצרת ב-0012_contact_activity.sql — סיכום פעילות לכל איש קשר. */
      contact_activity: {
        Row: {
          contact_id: string;
          last_any_at: string | null;
          /** רק מה שהלקוח יזם: whatsapp_in, quiz_submitted, booking_created/cancelled */
          last_customer_at: string | null;
          last_inbound_at: string | null;
          last_inbound_text: string | null;
          last_customer_type: InteractionType | null;
          last_any_type: InteractionType | null;
          inbound_count: number;
        };
        Relationships: Relationships;
      };
    };
    Functions: { [_ in never]: never };
  };
};

export type Contact = Database["public"]["Tables"]["contacts"]["Row"];
export type ContactStatusRow = Database["public"]["Tables"]["contact_statuses"]["Row"];
export type ContactField = Database["public"]["Tables"]["contact_fields"]["Row"];
export type Interaction = Database["public"]["Tables"]["interactions"]["Row"];
export type MessageTemplate = Database["public"]["Tables"]["message_templates"]["Row"];
export type AutomationRule = Database["public"]["Tables"]["automation_rules"]["Row"];
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
export type WhatsAppSettings = Database["public"]["Tables"]["whatsapp_settings"]["Row"];
export type BookingSettings = Database["public"]["Tables"]["booking_settings"]["Row"];
export type BookingEventType = Database["public"]["Tables"]["booking_event_types"]["Row"];
export type BookingAvailability = Database["public"]["Tables"]["booking_availability"]["Row"];
export type BookingBlackout = Database["public"]["Tables"]["booking_blackouts"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type Journey = Database["public"]["Tables"]["journeys"]["Row"];
export type JourneyStep = Database["public"]["Tables"]["journey_steps"]["Row"];
export type JourneyEdge = Database["public"]["Tables"]["journey_edges"]["Row"];
export type JourneyEnrollment = Database["public"]["Tables"]["journey_enrollments"]["Row"];
export type CourseLead = Database["public"]["Tables"]["course_leads"]["Row"];
export type BookingDateOverride = Database["public"]["Tables"]["booking_date_overrides"]["Row"];
