-- Email deliveries (spec 0006, kind I: infrastructure, no tenant owner). The outbox of every
-- product email SME24 sends: one row per intended email, written before anything is rendered,
-- updated by the send-email task and by the Resend webhook, read by ops on /admin/emails.
-- The organization and the recipient are references for the ops view only, both nullable and
-- kept when the target goes away, so the trail outlives the tenant (no cascade).
-- Not audited: the row is its own trail (structured log plus last_run_id), and an audit row per
-- status change would triple the table. Purged after 90 days by purge-email-deliveries.

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  -- The caller's key (`welcome/<organizationId>`): one row per intended email, whatever the
  -- number of triggers. The Trigger.dev idempotency key carries the same string.
  idempotency_key text not null unique,
  source_event text not null check (char_length(source_event) between 1 and 100),
  template text not null check (char_length(template) between 1 and 100),
  -- The short language codes of src/i18n/routing.ts, like profiles.locale.
  locale text not null check (locale in ('de', 'en')),
  -- Empty when the recipient could not be resolved (status skipped, recipient_missing); a retry
  -- resolves the address again only when this column is empty.
  recipient_email text not null check (char_length(recipient_email) <= 320),
  recipient_id uuid null references public.profiles (id) on delete set null,
  organization_id uuid null references public.organizations (id) on delete set null,
  -- Set after the render, from the template's subject key.
  subject text null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped')),
  transport text null check (transport in ('resend', 'smtp')),
  provider_message_id text null,
  error text null,
  -- Task attempts across every run of the row, incremented at the start of each attempt.
  attempts integer not null default 0 check (attempts >= 0),
  last_run_id text null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  delivered_at timestamptz null,
  failed_at timestamptz null,
  updated_at timestamptz not null default now()
);

comment on table public.email_deliveries is 'Outbox of every product email: one row per intended send, status from the task and the Resend webhook. Ops read; only the service key writes. Purged after 90 days.';
comment on column public.email_deliveries.idempotency_key is 'The caller''s key, unique: a second trigger with the same key reuses the row.';
comment on column public.email_deliveries.status is 'queued, sending, sent, delivered, bounced, complained, failed or skipped; moves forward only, except the ops retry (failed to sending).';
comment on column public.email_deliveries.attempts is 'Task attempts across all runs; the provider idempotency key is <id>/<attempts>.';
comment on column public.email_deliveries.error is 'The reason of a failed or skipped row: invalid_data, render_failed, no_transport, not_allowlisted, recipient_missing or the provider message.';

create index email_deliveries_status_created_at_idx on public.email_deliveries (status, created_at desc);
create index email_deliveries_recipient_id_idx on public.email_deliveries (recipient_id);
create index email_deliveries_organization_id_idx on public.email_deliveries (organization_id);
-- Keyset paging on /admin/emails and the purge cutoff.
create index email_deliveries_created_at_id_idx on public.email_deliveries (created_at desc, id desc);
-- The webhook finds the row by the provider id; the partial index skips SMTP rows.
create unique index email_deliveries_provider_message_id_idx
  on public.email_deliveries (provider_message_id)
  where provider_message_id is not null;

alter table public.email_deliveries enable row level security;

create policy "email_deliveries: ops read"
  on public.email_deliveries
  for select
  to authenticated
  using ((select private.is_ops()));

-- Only the service key (the task, the webhook) writes a delivery: no policy grants a write, and
-- the verbs are revoked from the app roles so a write raises rather than filters.
revoke insert, update, delete on public.email_deliveries from anon, authenticated;

create trigger email_deliveries_set_updated_at
  before update on public.email_deliveries
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.email_deliveries from anon, authenticated, service_role;
