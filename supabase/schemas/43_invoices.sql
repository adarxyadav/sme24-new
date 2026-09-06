-- Invoices (spec 0011, kind T: tenant). One immutable numbered invoice per paid or bank transfer
-- order, retained ten years under Swiss bookkeeping rules: never deleted, only cancelled.
--
-- The number comes from public.invoice_number_seq and must be gapless (invariant 3). It is drawn
-- inside the transaction that inserts this row, and that transaction contains only the order
-- status update, its order_events row and this insert: no external call, no enqueue, no Storage
-- write. Postgres sequences do not roll back, so a transaction that fails for an unrelated reason
-- would burn a number; keeping the transaction that small is what makes gaplessness enforceable.
--
-- Once issued, a row changes only in its PDF columns and cancelled_at (invariant 7), enforced by
-- the column grant plus the immutability trigger below.
--
-- Like public.orders there is deliberately NO assigned experts read policy: an expert learns that
-- an assessment is booked from feature 12, never what it cost or where to invoice (see 41_orders.sql).

create sequence if not exists public.invoice_number_seq as bigint start 1;
comment on sequence public.invoice_number_seq is 'Supplies the counter in the <year>-<4 digits> invoice number. Gapless by contract: drawn only inside the small issuing transaction of spec 0011 invariant 3.';

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- One invoice per order; restrict, because an issued invoice must outlive any order cleanup.
  order_id uuid not null unique references public.orders (id) on delete restrict,
  -- 2026-0001, formatted from invoice_number_seq.
  number text not null unique check (number ~ '^[0-9]{4}-[0-9]{4,}$'),
  issued_at timestamptz not null default now(),
  due_date date not null,
  -- The seller facts frozen at issue, so changing the configuration never rewrites history.
  seller_name text not null check (char_length(seller_name) between 1 and 200),
  seller_address text not null check (char_length(seller_address) between 1 and 500),
  seller_uid text not null check (char_length(seller_uid) between 1 and 30),
  seller_iban text not null check (char_length(seller_iban) between 15 and 34),
  -- The SCOR (ISO 11649) creditor reference printed on the QR bill, derived from the number.
  qr_reference text not null unique check (qr_reference ~ '^RF[0-9]{2}[0-9A-Z]{1,21}$'),
  -- Supabase Storage object path, null until the render task succeeds.
  pdf_path text null,
  pdf_rendered_at timestamptz null,
  -- Set when the render exhausts its retries; both null means still rendering, and a successful
  -- retry clears it. This is how ops tell "in flight" from "needs a retry".
  pdf_failed_at timestamptz null,
  -- Set when ops cancels the order; the row is never deleted.
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoices is 'One immutable numbered invoice per order. Retained ten years: never deleted, only cancelled. After issue only the PDF columns and cancelled_at may change.';
comment on column public.invoices.number is 'Gapless <year>-<counter> from public.invoice_number_seq. The series includes cancelled invoices, so an invoice count is not a sales count: filter on cancelled_at is null for revenue.';
comment on column public.invoices.qr_reference is 'ISO 11649 SCOR creditor reference derived from the invoice number, printed on the Swiss QR bill.';
comment on column public.invoices.pdf_failed_at is 'Set when the render task exhausts its retries. pdf_path and pdf_failed_at both null means the render is still in flight; pdf_failed_at set means ops must retry. Cleared on a successful retry.';

create index invoices_organization_id_issued_at_idx on public.invoices (organization_id, issued_at desc);
-- Ops list the rows that need a retry.
create index invoices_pdf_failed_idx on public.invoices (pdf_failed_at) where pdf_failed_at is not null;

alter table public.invoices enable row level security;

create policy "invoices: members read their organization"
  on public.invoices
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- No members insert or update policy: an invoice is issued by settleOrder through the service
-- client, never by a browser. And no assigned experts read policy (see the header).

create policy "invoices: ops read"
  on public.invoices
  for select
  to authenticated
  using ((select private.is_ops()));

-- Ops retry a failed render and cancel; the column grant below limits which columns that touches.
create policy "invoices: ops update"
  on public.invoices
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- Immutability (invariant 7). An issued invoice may change only in its PDF columns and
-- cancelled_at; the number, the amounts' order link, the dates and the frozen seller facts are
-- fixed forever. The column grant stops the app roles, this trigger stops the service role too,
-- so a task bug cannot rewrite a number either.
create or replace function private.check_invoice_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.order_id is distinct from old.order_id
     or new.number is distinct from old.number
     or new.issued_at is distinct from old.issued_at
     or new.due_date is distinct from old.due_date
     or new.seller_name is distinct from old.seller_name
     or new.seller_address is distinct from old.seller_address
     or new.seller_uid is distinct from old.seller_uid
     or new.seller_iban is distinct from old.seller_iban
     or new.qr_reference is distinct from old.qr_reference
     or new.created_at is distinct from old.created_at then
    raise exception 'an issued invoice is immutable except for its pdf columns and cancelled_at'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_invoice_immutable() from public;

create trigger invoices_check_immutable
  before update on public.invoices
  for each row execute function private.check_invoice_immutable();

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function private.audit_row();

-- Clients never write an invoice. Ops touch only the retry and cancel columns: the table level
-- UPDATE is revoked from authenticated and granted back per column, so even ops cannot change a
-- number through the API. The declarative diff drops column grants after a table level REVOKE, so
-- a migration re adds this grant by hand (AGENTS.md).
revoke insert, update, delete on public.invoices from anon, authenticated;
grant update (pdf_path, pdf_rendered_at, pdf_failed_at, cancelled_at) on public.invoices to authenticated;

-- Ten year retention: an invoice is never deleted, so TRUNCATE is closed to every role including
-- the service key.
revoke truncate on public.invoices from anon, authenticated, service_role;
