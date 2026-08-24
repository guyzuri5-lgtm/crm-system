// Hand-written to match supabase/migrations/0001_init.sql.
//
// Once the project is linked to a real Supabase project, regenerate this from the
// live schema instead of hand-editing it further:
//   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts

// `as const` arrays (rather than plain union types) so the same list can drive a
// zod schema (z.enum(CONTACT_STATUSES)) and a <select> options list, not just types.
export const CONTACT_STATUSES = [
  "ליד_חדש",
  "יצרנו_קשר",
  "מתעניין",
  "סגר_עסקה",
  "לא_רלוונטי",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type InteractionType =
  | "manychat_in"
  | "manychat_out"
  | "email_out"
  | "manual_note"
  // נוסף ב-0002_quiz.sql — נרשם ביומן איש הקשר כשמישהו ממלא את שאלון הצ'אקרות
  | "quiz_submitted";

/** סוגי רשומה בשאלון, לפי סדר עולה של "חום" הליד */
export const QUIZ_KINDS = ["anonymous", "lead", "booking_click"] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  anonymous: "אנונימי",
  lead: "השאיר פרטים",
  booking_click: "יצא לקבוע פגישה",
};

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
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
  };
};

export type Contact = Database["public"]["Tables"]["contacts"]["Row"];
export type Interaction = Database["public"]["Tables"]["interactions"]["Row"];
export type MessageTemplate = Database["public"]["Tables"]["message_templates"]["Row"];
export type AutomationRule = Database["public"]["Tables"]["automation_rules"]["Row"];
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];
