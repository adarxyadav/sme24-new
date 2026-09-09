-- Data requests (spec 0015, kind I: infrastructure, no tenant owner). One row per exercise of a
-- data subject right: a copy of your data (export) or its deletion. The subject files it from a
-- signed in page; ops work it on /admin/data-requests within the thirty day Art. 25 answer window
-- that `due_at` carries. Modelled on `enquiries` (spec 0009), which is the same shape of ops
-- worked queue, with three differences: the subject inserts their own row and can read it back,
-- `UPDATE` is revoked from every app role (the ops action writes through the service client), and
-- the transitions live in the action rather than a trigger, because no money moves.
--
-- Retention: none. The row is the compliance artefact proving a request was made and answered, so
-- it outlives the profile it is about (`requested_by` is set null on delete, never cascaded) and
-- has no purge task. Insert and the two ops columns are audited; in a compliance feature that is
-- not negotiable.

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('export', 'deletion')),
  -- The subject. Nullable and set null on delete on purpose: a cascade would delete the evidence
  -- that a deletion was performed, which is the opposite of what a record is for.
  requested_by uuid null references public.profiles (id) on delete set null,
  -- The subject's organization at filing time, for the ops view only; null when they have none
  -- (an expert usually does), which is expected and never guarded against.
  organization_id uuid null references public.organizations (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'in_progress', 'fulfilled', 'refused')),
  -- created_at + 30 days, the Art. 25 answer deadline; written by the action, never recomputed.
  due_at timestamptz not null,
  -- The ops user who first moved the row out of `new`, and when; written once, never cleared.
  handled_by uuid null references public.profiles (id) on delete set null,
  handled_at timestamptz null,
  -- What was done, or why it was refused. A refusal requires it; the app enforces that, because
  -- "non empty when the status is refused" is a rule the ops action already owns end to end.
  ops_note text null check (char_length(ops_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- handled_by and handled_at are both null or both set (spec 0015, key invariants).
  constraint data_requests_handled_together check ((handled_by is null) = (handled_at is null))
);

comment on table public.data_requests is 'Data subject requests (export or deletion) filed by the subject and worked by ops within 30 days. No retention: the row is the record that the right was exercised and answered.';
comment on column public.data_requests.kind is 'export (a copy of the data, assembled and sent by ops outside the app) or deletion (anonymisation through updateDataRequest).';
comment on column public.data_requests.requested_by is 'The subject. Set null when the profile goes, so the record outlives the person it is about.';
comment on column public.data_requests.due_at is 'created_at + 30 days in UTC; only the overdue comparison converts to Europe/Zurich.';
comment on column public.data_requests.status is 'new -> in_progress -> fulfilled, with refused as the exit from either. fulfilled and refused are terminal; more is a new request.';
comment on column public.data_requests.handled_at is 'Set with handled_by the first time the status leaves new, in the same statement as the change; never cleared.';

-- The ops queue, ordered by deadline.
create index data_requests_status_due_at_idx on public.data_requests (status, due_at);
-- The subject's own list.
create index data_requests_requested_by_idx on public.data_requests (requested_by, created_at desc);
create index data_requests_organization_id_idx on public.data_requests (organization_id);
-- At most one open request per person per kind, so a double click cannot queue two (AC-11). The
-- guard is the index, never the app: two concurrent inserts both pass an application read.
create unique index data_requests_open_idx
  on public.data_requests (requested_by, kind)
  where status in ('new', 'in_progress');

alter table public.data_requests enable row level security;

-- The subject reads their own rows; ops read every row.
create policy "data_requests: subject reads own"
  on public.data_requests
  for select
  to authenticated
  using ((select auth.uid()) = requested_by);

create policy "data_requests: ops read"
  on public.data_requests
  for select
  to authenticated
  using ((select private.is_ops()));

-- Anyone signed in files for themselves and nobody else. The column grant below is what stops the
-- insert naming a status, a due date or a handler.
create policy "data_requests: subject files own"
  on public.data_requests
  for insert
  to authenticated
  with check ((select auth.uid()) = requested_by);

-- The subject supplies exactly what the request is: its kind, whose it is, and the deadline the
-- action computes. Everything else is defaulted or written later by ops.
revoke insert, update, delete on public.data_requests from anon, authenticated;
grant insert (kind, requested_by, organization_id, due_at) on public.data_requests to authenticated;

-- UPDATE stays revoked from every app role (AC-14): `updateDataRequest` authorises the ops caller
-- itself and writes through the service client, the same shape spec 0014 uses for orders, because
-- the proxy never runs for a server action post.

create trigger data_requests_set_updated_at
  before update on public.data_requests
  for each row execute function public.set_updated_at();

-- Insert and the two ops decision columns are audited (AC-14).
create trigger data_requests_audit
  after insert or update of status, ops_note on public.data_requests
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe the whole compliance
-- record at once and leave nothing in the audit log. Supabase's default privileges hand it to all
-- three app roles at creation, so every table revokes it explicitly.
revoke truncate on public.data_requests from anon, authenticated, service_role;
