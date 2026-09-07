-- Stripe events (spec 0011, kind I: infrastructure, no tenant owner). One row per webhook event
-- Stripe delivers, keyed on Stripe's own event id. The primary key IS the idempotency guard
-- (AC-7, invariant 6): a redelivery collides on insert and the route returns 200 without doing
-- the work twice. No read then write check anywhere in the app.
--
-- Written by the service role only (the webhook route holds no session), read by ops for
-- reconciliation. The payload carries no card data (Stripe never sends it) but does carry the
-- buyer's email, so it falls under the FADP retention rules; a purge-stripe-events task mirroring
-- purge-email-deliveries is a follow up of spec 0011, not part of this feature.

create table public.stripe_events (
  -- Stripe's own event id, evt_.... The primary key is the whole deduplication mechanism.
  event_id text primary key check (char_length(event_id) between 3 and 255),
  type text not null check (char_length(type) between 1 and 100),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  -- Set by the confirmation task once it has handled the event; null means received but not yet
  -- applied, which is what a reconciliation sweep would look for.
  processed_at timestamptz null,
  error text null check (error is null or char_length(error) <= 2000)
);

comment on table public.stripe_events is 'Every Stripe webhook event, keyed on Stripe''s event id so a redelivery is a no operation. Service role writes, ops read. No organization_id: the order id is inside the payload.';
comment on column public.stripe_events.event_id is 'Stripe''s evt_... id. Being the primary key is what makes a duplicate delivery harmless (spec 0011, AC-7).';
comment on column public.stripe_events.processed_at is 'Set when the confirmation task finished with the event; null with an old received_at is an event that never got applied.';

create index stripe_events_received_at_idx on public.stripe_events (received_at desc);
create index stripe_events_type_received_at_idx on public.stripe_events (type, received_at desc);
-- The reconciliation view: received but never applied.
create index stripe_events_unprocessed_idx on public.stripe_events (received_at) where processed_at is null;

alter table public.stripe_events enable row level security;

create policy "stripe_events: ops read"
  on public.stripe_events
  for select
  to authenticated
  using ((select private.is_ops()));

-- Only the service key (the webhook route, the confirmation task) writes. No client, and not even
-- ops: an event log that ops can edit is not an event log.
revoke insert, update, delete on public.stripe_events from anon, authenticated;

revoke truncate on public.stripe_events from anon, authenticated, service_role;
