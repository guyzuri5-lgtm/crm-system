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

export type InteractionType =
  | "manychat_in"
  | "manychat_out"
  | "email_out"
  | "manual_note"
  // נוסף ב-0002_quiz.sql — נרשם ביומן איש הקשר כשמישהו ממלא את שאלון הצ'אקרות
  | "quiz_submitted"
  // נוספו ב-0005_booking.sql — קביעת פגישה וביטולה
  | "booking_created"
  | "booking_cancelled";

/** סוגי רשומה בשאלון, לפי סדר עולה של "חום" הליד */
export const QUIZ_KINDS = ["anonymous", "lead", "booking_click"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  anonymous: "אנונימי",
  lead: "השאיר פרטים",
  booking_click: "יצא לקבוע פגישה",
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
          manychat_subscriber_id: string | null;
          last_incoming_message_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
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
      interactions: {
        Row: {
          id: string;
          contact_id: string;
          type: InteractionType;
          content: string | null;
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
          manychat_template_id: string | null;
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
      booking_settings: {
        Row: {
          id: boolean;
          timezone: string;
          calendar_id: string;
          busy_calendar_ids: string[];
          brand_name: string;
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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export type Contact = Database["public"]["Tables"]["contacts"]["Row"];
export type ContactStatusRow = Database["public"]["Tables"]["contact_statuses"]["Row"];
export type Interaction = Database["public"]["Tables"]["interactions"]["Row"];
export type MessageTemplate = Database["public"]["Tables"]["message_templates"]["Row"];
export type AutomationRule = Database["public"]["Tables"]["automation_rules"]["Row"];
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
export type BookingSettings = Database["public"]["Tables"]["booking_settings"]["Row"];
export type BookingEventType = Database["public"]["Tables"]["booking_event_types"]["Row"];
export type BookingAvailability = Database["public"]["Tables"]["booking_availability"]["Row"];
export type BookingBlackout = Database["public"]["Tables"]["booking_blackouts"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
