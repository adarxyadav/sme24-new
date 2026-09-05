-- Notifications (spec 0006, kind U: owned by recipient_id). The in app notification feed, fed by
-- the send-email task next to every email to a known user (whatever the email outcome), read by
-- feature 23. A recipient reads their own rows and marks them read (the read_at column grant);
-- nobody inserts through the API, only the service key writes. Deleting the user deletes the
-- rows; the organization and the delivery are references only.
-- Not audited: a notification is a copy of an email the outbox already records.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid null references public.organizations (id) on delete set null,
  -- The template name of the email this notification mirrors.
  kind text not null check (char_length(kind) between 1 and 100),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  -- The bare app path without a locale prefix; feature 23 prefixes it at render time.
  link text null check (link is null or link ~ '^/'),
  delivery_id uuid null references public.email_deliveries (id) on delete set null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.notifications is 'In app notification feed: one row per email to a known user. The recipient reads their own rows and sets read_at; only the service key inserts.';
comment on column public.notifications.link is 'App path without the locale prefix, prefixed when rendered (feature 23).';

create index notifications_recipient_id_read_at_created_at_idx
  on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_organization_id_idx on public.notifications (organization_id);
create index notifications_delivery_id_idx on public.notifications (delivery_id);

alter table public.notifications enable row level security;

create policy "notifications: recipients read their own"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = (select auth.uid()));

-- The column grant below narrows this to read_at.
create policy "notifications: recipients update their own"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- Nobody inserts or deletes a notification through the API; the task writes with the service key.
revoke insert, delete on public.notifications from anon, authenticated;
-- A recipient may mark a notification read and change nothing else.
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.notifications from anon, authenticated, service_role;
