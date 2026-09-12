-- Directory unlocks (spec 0018, kind E: owned by an expert). One row per contact an expert has
-- paid one credit to reveal; its existence is what makes the raw email and phones of that contact
-- readable to that expert, through directory_search and directory_unlocked_contacts, for good.
--
-- DEVIATION FROM KIND E (spec 0002): the kind E template lets the expert write their own rows.
-- Here the write costs money, so it is a function: public.directory_reveal inserts the unlock and
-- the ledger debit in one transaction under an advisory lock (AC-11), and insert, update and
-- delete are revoked from every app role. Audit trigger on, like every access granting row.

create table public.directory_unlocks (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.profiles (id) on delete cascade,
  -- Cascade: a removed contact takes the unlock with it (AC-15); the ledger row keeps the debit
  -- with unlock_id set null, so the balance never changes on a removal.
  contact_id uuid not null references public.directory_contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One unlock per expert per contact (invariant 3): a second reveal returns the row for free.
  unique (expert_id, contact_id)
);

comment on table public.directory_unlocks is 'A contact an expert paid one credit to reveal (spec 0018). Written only by directory_reveal; its existence unmasks the row for that expert.';

-- The unlocks page and the CSV export walk an expert's rows newest first by keyset.
create index directory_unlocks_expert_created_idx
  on public.directory_unlocks (expert_id, created_at desc, id);
create index directory_unlocks_contact_id_idx on public.directory_unlocks (contact_id);

alter table public.directory_unlocks enable row level security;

create policy "directory_unlocks: experts read their own"
  on public.directory_unlocks
  for select
  to authenticated
  using (expert_id = (select auth.uid()));

create policy "directory_unlocks: ops read"
  on public.directory_unlocks
  for select
  to authenticated
  using ((select private.is_ops()));

create trigger directory_unlocks_audit
  after insert or update or delete on public.directory_unlocks
  for each row execute function private.audit_row();

-- directory_reveal is the only write path (AC-11).
revoke insert, update, delete on public.directory_unlocks from anon, authenticated;
revoke truncate on public.directory_unlocks from anon, authenticated, service_role;
