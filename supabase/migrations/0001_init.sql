-- CRM schema — initial migration
-- Run this in the Supabase SQL editor (or `supabase db push` once the project is linked).
--
-- Two deliberate additions beyond the original spec (see project README section
-- "שינויים לעומת האפיון המקורי" for the full rationale):
--   1. contacts.manychat_subscriber_id — ManyChat's send APIs address subscribers by
--      subscriber_id, not phone number, and looking it up by phone after the fact is a
--      documented pain point. We capture it once, at webhook intake time, instead.
--   2. automation_rule_runs — without a "did this rule already fire for this contact"
--      record, the daily cron for time_since_no_reply rules would re-send the same
--      message every single day once a contact crosses the threshold.

create extension if not exists pgcrypto;

-- ── Reset (safe to re-run) ──────────────────────────────────────────────
-- This is the initial-setup script, meant to run once against a blank project — but
-- if a run fails partway through, Supabase's SQL editor does not necessarily roll
-- back statements that already committed before the failing one, so simply re-running
-- the same script hits "already exists" on whatever got created the first time. This
-- block tears down everything the script below creates (CASCADE takes care of
-- dependent triggers/indexes/policies), so the rest is always starting from a clean
-- slate — safe even on a project where this has never run at all (everything is
-- "if exists"). Only ever destructive to data created BY this migration, never to
-- auth.users itself.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop table if exists automation_rule_runs cascade;
drop table if exists interactions cascade;
drop table if exists automation_rules cascade;
drop table if exists message_templates cascade;
drop table if exists contacts cascade;
drop table if exists team_members cascade;
drop function if exists public.set_updated_at();
drop type if exists contact_status cascade;
drop type if exists interaction_type cascade;
drop type if exists message_channel cascade;
drop type if exists automation_trigger_type cascade;

-- ── Enums ────────────────────────────────────────────────────────────────
create type contact_status as enum (
  'ליד_חדש',
  'יצרנו_קשר',
  'מתעניין',
  'סגר_עסקה',
  'לא_רלוונטי'
);

create type interaction_type as enum (
  'manychat_in',
  'manychat_out',
  'email_out',
  'manual_note'
);

create type message_channel as enum ('email', 'whatsapp');

create type automation_trigger_type as enum ('status_change', 'time_since_no_reply');

-- ── team_members ────────────────────────────────────────────────────────
-- Everyone shares one permission level (per spec) — no role column.
-- id mirrors auth.users.id 1:1.
create table team_members (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  created_at timestamptz not null default now()
);

-- Auto-provision a team_members row whenever someone is added in Supabase Auth
-- (Authentication → Users → Invite), so nobody has to remember to double-enter people.
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.team_members (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── contacts ─────────────────────────────────────────────────────────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text unique,
  email text,
  status contact_status not null default 'ליד_חדש',
  source text not null default 'ManyChat',
  tags text[] not null default '{}',
  manychat_subscriber_id text unique,
  last_incoming_message_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_status_idx on contacts (status);
create index contacts_tags_idx on contacts using gin (tags);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function public.set_updated_at();

-- ── message_templates ───────────────────────────────────────────────────
create table message_templates (
  id uuid primary key default gen_random_uuid(),
  channel message_channel not null,
  name text not null,
  subject text,
  body text not null,
  -- For whatsapp templates only, and only when the template is meant to be sent
  -- OUTSIDE the 24h window: this must hold the ManyChat FLOW NAMESPACE (flow_ns) of a
  -- Flow you built in the ManyChat UI whose first step is the Meta-approved template
  -- message. ManyChat has no API to send an approved template directly by name — you
  -- send it by triggering the flow that contains it (POST /fb/sending/sendFlow).
  manychat_template_id text,
  created_at timestamptz not null default now()
);

-- ── automation_rules ────────────────────────────────────────────────────
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_type automation_trigger_type not null,
  -- status_change:        {"from_status": "ליד_חדש"}  (fires on any transition away from this status; omit for "any status")
  -- time_since_no_reply:  {"days": 3, "status": "יצרנו_קשר"}
  trigger_value jsonb not null default '{}',
  action_channel message_channel not null,
  action_template_id uuid not null references message_templates (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── interactions (log) ──────────────────────────────────────────────────
create table interactions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  type interaction_type not null,
  content text,
  created_at timestamptz not null default now()
);

create index interactions_contact_id_idx on interactions (contact_id, created_at desc);

-- ── automation_rule_runs (idempotency for time_since_no_reply) ─────────
create table automation_rule_runs (
  rule_id uuid not null references automation_rules (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  fired_at timestamptz not null default now(),
  primary key (rule_id, contact_id)
);

-- ── Row Level Security ──────────────────────────────────────────────────
-- The app talks to Supabase from the server only, using the service role key
-- (see src/lib/supabase/server.ts), which bypasses RLS entirely — these policies are
-- a second line of defense, not the primary access control. They just require *some*
-- logged-in team member, matching the spec's "everyone has the same permission" model,
-- in case the anon/publishable key is ever used from a client component.
alter table contacts enable row level security;
alter table interactions enable row level security;
alter table automation_rules enable row level security;
alter table message_templates enable row level security;
alter table team_members enable row level security;
alter table automation_rule_runs enable row level security;

create policy "team can read contacts" on contacts for select to authenticated using (true);
create policy "team can write contacts" on contacts for all to authenticated using (true) with check (true);

create policy "team can read interactions" on interactions for select to authenticated using (true);
create policy "team can write interactions" on interactions for all to authenticated using (true) with check (true);

create policy "team can read automation_rules" on automation_rules for select to authenticated using (true);
create policy "team can write automation_rules" on automation_rules for all to authenticated using (true) with check (true);

create policy "team can read message_templates" on message_templates for select to authenticated using (true);
create policy "team can write message_templates" on message_templates for all to authenticated using (true) with check (true);

create policy "team can read team_members" on team_members for select to authenticated using (true);

create policy "team can read automation_rule_runs" on automation_rule_runs for select to authenticated using (true);
