-- Directory credit entries (spec 0018, kind E: owned by an expert, append only). The credit
-- ledger: a purchase or an ops grant adds a positive row, an unlock adds -1, and the balance is
-- sum(delta) at read time, never stored (invariant 2). Written by public.settle_order (purchase,
-- in the same transaction as `paid`, AC-8), public.directory_reveal (unlock, AC-11) and, for a
-- grant or a refund, the service client after requireOps in a later slice; no UI writes those two
-- reasons yet (owner decision, 2026-09-12), the reasons exist so adding it needs no migration.
--
-- DEVIATION FROM KIND E (spec 0002): append only, like public.order_events. No app role may
-- insert, update or delete a row; the service role keeps its bypass for a genuine correction,
-- which the audit trigger records.

create table public.directory_credit_entries (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.profiles (id) on delete cascade,
  -- Positive for a purchase or a grant, negative for an unlock or a refund reversal.
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'unlock', 'grant', 'refund')),
  -- Set for `purchase`; restrict, because an order is kept ten years and its grant with it.
  order_id uuid null references public.orders (id) on delete restrict,
  -- Set for `unlock`; null after a removed contact cascades the unlock away (AC-15).
  unlock_id uuid null references public.directory_unlocks (id) on delete set null,
  -- The ops actor for a grant or a refund.
  created_by uuid null references public.profiles (id) on delete set null,
  note text null check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  -- The sign follows the reason, and a purchase always names its order.
  constraint directory_credit_entries_check_reason check (
    (reason in ('purchase', 'grant') and delta > 0)
    or (reason in ('unlock', 'refund') and delta < 0)
  ),
  constraint directory_credit_entries_check_order check (reason <> 'purchase' or order_id is not null)
);

comment on table public.directory_credit_entries is 'The append only credit ledger of the contact directory (spec 0018). Balance is sum(delta); written only by settle_order, directory_reveal and a service side ops correction.';
comment on column public.directory_credit_entries.delta is 'Credits added (purchase, grant) or removed (unlock, refund). Never zero; the balance is the sum.';

-- One grant per order, whatever the retries (invariant 4): settle_order inserts with
-- `on conflict do nothing` against this index.
create unique index directory_credit_entries_purchase_order_idx
  on public.directory_credit_entries (order_id) where reason = 'purchase';
-- One debit per unlock.
create unique index directory_credit_entries_unlock_idx
  on public.directory_credit_entries (unlock_id) where reason = 'unlock';
-- The balance is a sum over the expert's rows.
create index directory_credit_entries_expert_id_idx on public.directory_credit_entries (expert_id);

alter table public.directory_credit_entries enable row level security;

create policy "directory_credit_entries: experts read their own"
  on public.directory_credit_entries
  for select
  to authenticated
  using (expert_id = (select auth.uid()));

create policy "directory_credit_entries: ops read"
  on public.directory_credit_entries
  for select
  to authenticated
  using ((select private.is_ops()));

create trigger directory_credit_entries_audit
  after insert or update or delete on public.directory_credit_entries
  for each row execute function private.audit_row();

-- Append only for every app role (AC-11). The two definer functions and the service client are
-- the only writers.
revoke insert, update, delete on public.directory_credit_entries from anon, authenticated;
revoke truncate on public.directory_credit_entries from anon, authenticated, service_role;
