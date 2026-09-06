-- Enquiries (spec 0009, kind I: infrastructure, no tenant owner). One row per submission of the
-- contact form on the public site: a retainer request or a general question, written by the
-- service key from the `submitEnquiry` server action (anonymous visitors have no session), read
-- and worked by ops on /admin/enquiries. A signed in client's row links to their organization
-- for the ops view only; the link survives nothing (set null), the row outlives the tenant.
-- Personal data and ops decisions are audited (insert, and updates of status and ops_note); the
-- purge's ip_hash null out and its deletes are not, the task logs its counts instead.
-- Retention (purge-enquiries): ip_hash nulled after 30 days, closed rows deleted after 12 months.

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('retainer', 'general')),
  company_name text not null check (char_length(company_name) between 1 and 200),
  contact_name text not null check (char_length(contact_name) between 1 and 200),
  -- Stored trimmed and lowercased by the action; the check keeps a stray uppercase copy out.
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  phone text null check (char_length(phone) <= 40),
  -- The headcount bands of spec 0008.
  headcount_band text null check (headcount_band in ('1-49', '50-249', '250+')),
  message text not null check (char_length(message) between 20 and 2000),
  -- The short language code of the page the form was on (src/i18n/routing.ts).
  locale text not null check (locale in ('de', 'en')),
  -- SHA 256 hex of the caller's address, for the flood guard only; nulled after 30 days.
  ip_hash text null check (char_length(ip_hash) = 64),
  organization_id uuid null references public.organizations (id) on delete set null,
  submitted_by uuid null references public.profiles (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  -- The ops user who first moved the row out of `new`, and when; written once, never cleared.
  handled_by uuid null references public.profiles (id) on delete set null,
  handled_at timestamptz null,
  ops_note text null check (char_length(ops_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.enquiries is 'Contact form submissions (retainer requests and general questions). Only the service key inserts; ops read every row and change the four workflow columns. ip_hash nulled after 30 days, closed rows deleted after 12 months.';
comment on column public.enquiries.topic is 'retainer (the package sold by conversation) or general.';
comment on column public.enquiries.ip_hash is 'SHA 256 hex of the first forwarded address, for the hourly flood guard only; never shown, nulled after 30 days.';
comment on column public.enquiries.status is 'new, contacted or closed; any status may follow any other, so a closed enquiry can be reopened.';
comment on column public.enquiries.handled_at is 'Set with handled_by the first time the status leaves new, in the same statement as the change; never cleared.';

create index enquiries_created_at_idx on public.enquiries (created_at desc);
create index enquiries_status_created_at_idx on public.enquiries (status, created_at desc);
-- The hourly guard counts by address; the partial index skips purged rows.
create index enquiries_ip_hash_created_at_idx
  on public.enquiries (ip_hash, created_at desc)
  where ip_hash is not null;
-- The daily guard counts by address.
create index enquiries_email_created_at_idx on public.enquiries (email, created_at desc);
create index enquiries_organization_id_idx on public.enquiries (organization_id);

alter table public.enquiries enable row level security;

create policy "enquiries: ops read"
  on public.enquiries
  for select
  to authenticated
  using ((select private.is_ops()));

-- The policy says who; the column grant below says what: status, handled_by, handled_at, ops_note.
create policy "enquiries: ops update"
  on public.enquiries
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- Only the service key (the action, the purge) inserts and deletes; the app roles cannot. Ops
-- change the four workflow columns and nothing else: the message, the contact fields and the
-- address hash are immutable after insert.
revoke insert, update, delete on public.enquiries from anon, authenticated;
grant update (status, handled_by, handled_at, ops_note) on public.enquiries to authenticated;

create trigger enquiries_set_updated_at
  before update on public.enquiries
  for each row execute function public.set_updated_at();

-- Personal data and ops decisions are audited; the purge's ip_hash null out is not (a column
-- outside this list fires no update audit) and its deletes are not (no delete event).
create trigger enquiries_audit
  after insert or update of status, ops_note on public.enquiries
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.enquiries from anon, authenticated, service_role;
