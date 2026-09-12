-- Order events (spec 0011, kind T: tenant, append only). One row per order state change, written
-- beside the status update in the same transaction: who moved it, from what to what and why
-- (AC-13). The audit_log trigger records the same change for the compliance trail; this table is
-- the client and ops facing history, joined to the order and readable by the owning organization.
--
-- Append only like public.audit_log: no app role may update or delete a row, so the history of a
-- payment cannot be rewritten after the fact.
--
-- Like public.orders there is deliberately NO assigned experts read policy: the payment history
-- of an assessment is client and ops business (see 41_orders.sql).

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  -- Null on the trail row of an expert's credit pack order (spec 0018); the order id is the join.
  organization_id uuid null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  -- Null on the row that records the order's creation.
  from_status text null check (from_status is null or from_status in ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
  to_status text not null check (to_status in ('pending', 'paid', 'cancelled', 'refunded', 'expired')),
  -- No foreign key: the trail outlives the user, the same choice audit_log makes.
  actor_id uuid null,
  actor_role text not null check (actor_role in ('client', 'expert', 'ops', 'service', 'system')),
  reason text null check (reason is null or char_length(reason) <= 500),
  occurred_at timestamptz not null default now()
);

comment on table public.order_events is 'Append only history of every orders state change: from, to, who and why. No app role may update or delete a row.';
comment on column public.order_events.actor_id is 'The acting user, or null for the webhook task and the sweep. No foreign key, so the trail survives a deleted account.';
comment on column public.order_events.actor_role is 'client, ops, service (a task) or system. This feature writes client, ops and service; system stays for the wider convention of spec 0002.';

create index order_events_order_id_occurred_at_idx on public.order_events (order_id, occurred_at desc);
create index order_events_organization_id_idx on public.order_events (organization_id);

alter table public.order_events enable row level security;

create policy "order_events: members read their organization"
  on public.order_events
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- A client's own insert accompanies the order they just created: their organization, themselves
-- as actor, and the only state a client action can produce.
create policy "order_events: members record their own order creation"
  on public.order_events
  for insert
  to authenticated
  with check (
    organization_id = (select private.jwt_org_id())
    and actor_id = (select auth.uid())
    and actor_role = 'client'
    and to_status = 'pending'
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.organization_id = order_events.organization_id
    )
  );

-- The expert buyer (spec 0018, AC-7): the history of the credit pack orders they bought, and the
-- creation row of their own order, the shape the client policy above has.
create policy "order_events: expert buyers read their own orders"
  on public.order_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_expert_id = (select auth.uid())
    )
  );

create policy "order_events: experts record their own order creation"
  on public.order_events
  for insert
  to authenticated
  with check (
    organization_id is null
    and actor_id = (select auth.uid())
    and actor_role = 'expert'
    and to_status = 'pending'
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_expert_id = (select auth.uid())
    )
  );

-- Ops read every row and insert their own; the ALL policy would also permit update and delete,
-- so ops get select and insert only and the revoke below closes the rest for every app role.
create policy "order_events: ops read"
  on public.order_events
  for select
  to authenticated
  using ((select private.is_ops()));

create policy "order_events: ops insert"
  on public.order_events
  for insert
  to authenticated
  with check ((select private.is_ops()));

-- Append only (AC-13, invariant 8). No app role may rewrite history, ops included; the service
-- role keeps its bypass for a genuine correction, which the audit log records.
revoke update, delete on public.order_events from anon, authenticated;

revoke truncate on public.order_events from anon, authenticated, service_role;
