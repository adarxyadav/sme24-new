-- Peer companies (spec 0012): the named Swiss peers a client is compared against. A peer is an
-- ordinary `companies` row inside the one ops owned house organization (no members by design),
-- researched by the unchanged pipeline, and this table carries the part that is peer specific:
-- the industry section and size band the peer belongs to, its status, its anonymous display
-- label and when it was last researched. Peer KPI values are ordinary `company_kpis` rows.
--
-- Two policies below widen `companies` and `company_kpis` so any signed in user reads an
-- approved peer's rows; they are additive to the tenant policies and can never expose a client
-- row, because a client company is never in this table.

-- The house organization: one fixed id, seeded by the migration that created this file. Every
-- policy, guard and quota branch keys on this function rather than on a literal.
create or replace function private.house_organization_id()
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select '99999999-9999-4999-8999-999999999999'::uuid;
$$;

revoke execute on function private.house_organization_id() from public;
grant execute on function private.house_organization_id() to authenticated, service_role;

-- Marks a peer so ops screens and the widened reads can tell one from a client company. Not a
-- filter for client queries: those are scoped by RLS on organization_id already.
alter table public.companies
  add column is_peer boolean not null default false;

comment on column public.companies.is_peer is 'True for a peer company inside the house organization (spec 0012); never true for a client company.';

create table public.peer_companies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  industry_section text not null check (industry_section ~ '^[A-U]$'),
  size_band text not null check (size_band in ('1-49', '50-249', '250+', 'all')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'retired')),
  display_label text null check (display_label ~ '^Peer [A-J]$'),
  proposed_by text not null check (proposed_by in ('ai', 'ops')),
  proposal jsonb null,
  rejection_reason text null,
  approved_by uuid null references public.profiles (id) on delete set null,
  approved_at timestamptz null,
  researched_at timestamptz null,
  last_run_id uuid null references public.research_runs (id) on delete set null,
  failed_refreshes integer not null default 0 check (failed_refreshes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The label exists exactly when the peer is approved: approving assigns it, retiring clears it.
  constraint peer_companies_label_iff_approved check ((status = 'approved') = (display_label is not null)),
  constraint peer_companies_approved_at_when_approved check (status <> 'approved' or approved_at is not null)
);

comment on table public.peer_companies is 'A named peer company (spec 0012): section, band, status, anonymous label and refresh state; the company itself lives in the house organization.';
comment on column public.peer_companies.proposal is '{model, promptVersion, reason, proposedAt} when a model proposed the peer; null when ops added it by hand.';
comment on column public.peer_companies.researched_at is 'When the last run ended succeeded or empty; drives the yearly refresh.';
comment on column public.peer_companies.failed_refreshes is 'Consecutive failed runs; reset on success, at 3 the peer is flagged and the schedule skips it.';

create unique index peer_companies_label_idx
  on public.peer_companies (industry_section, size_band, display_label)
  where display_label is not null;
create index peer_companies_set_idx on public.peer_companies (industry_section, size_band, status);
create index peer_companies_refresh_idx on public.peer_companies (status, researched_at);
create index peer_companies_approved_by_idx on public.peer_companies (approved_by);
create index peer_companies_last_run_id_idx on public.peer_companies (last_run_id);

alter table public.peer_companies enable row level security;

-- Any signed in user reads an approved peer: the label and the refresh date feed the disclosure.
create policy "peer_companies: signed in users read approved peers"
  on public.peer_companies
  for select
  to authenticated
  using (status = 'approved');

create policy "peer_companies: ops full access"
  on public.peer_companies
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- A peer row always points at a company of the house organization marked is_peer. Checked here
-- rather than only in the action, so the service client and ops cannot attach a client company.
create or replace function private.check_peer_company()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies c
    where c.id = new.company_id
      and c.organization_id = private.house_organization_id()
      and c.is_peer
  ) then
    raise exception 'a peer must be a company of the house organization marked is_peer'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_peer_company() from public;

create trigger peer_companies_check_company
  before insert or update of company_id on public.peer_companies
  for each row execute function private.check_peer_company();

create trigger peer_companies_set_updated_at
  before update on public.peer_companies
  for each row execute function public.set_updated_at();

create trigger peer_companies_audit
  after insert or update or delete on public.peer_companies
  for each row execute function private.audit_row();

revoke truncate on public.peer_companies from anon, authenticated, service_role;

-- The house organization has no members. A stray membership row would hand that user
-- jwt_org_id() = house organization and a client style view of every peer company.
create or replace function private.check_no_house_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id = private.house_organization_id() then
    raise exception 'the house organization has no members'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_no_house_membership() from public;

create trigger organization_members_check_no_house_membership
  before insert or update of organization_id on public.organization_members
  for each row execute function private.check_no_house_membership();

-- The two widened reads (spec 0012, AC-7). Both read peer_companies, never the table they sit
-- on, so neither recurses; both hit the unique (company_id) index.
create policy "companies: signed in users read approved peers"
  on public.companies
  for select
  to authenticated
  using (
    is_peer
    and organization_id = (select private.house_organization_id())
    and exists (
      select 1 from public.peer_companies pc
      where pc.company_id = companies.id and pc.status = 'approved'
    )
  );

create policy "company_kpis: signed in users read approved peers"
  on public.company_kpis
  for select
  to authenticated
  using (
    exists (
      select 1 from public.peer_companies pc
      where pc.company_id = company_kpis.company_id and pc.status = 'approved'
    )
  );

-- The research quota gains a branch for the house organization (spec 0012, AC-5): a ten peer
-- batch must never trip the client limit, and a runaway loop still stops in the database. The
-- house limit mirrors HOUSE_RUN_LIMIT_PER_DAY in src/features/peers/catalogue.ts; the client
-- branch is unchanged (RUN_LIMIT_PER_DAY in src/features/research/catalogue.ts).
create or replace function private.research_run_allowed(organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_limit integer := case
    when organization_id = private.house_organization_id() then 50
    else 5
  end;
begin
  if organization_id is null then
    return false;
  end if;
  return (
    select count(*)
    from public.research_runs r
    where r.organization_id = research_run_allowed.organization_id
      and r.created_at > now() - interval '24 hours'
      and r.error_code is distinct from 'trigger_failed'
  ) < run_limit;
end;
$$;

-- Approval (spec 0012, AC-3): one transaction under an advisory lock on the section and band,
-- refuses beyond ten approved peers, assigns the next free label Peer A to Peer J and stamps
-- who approved and when from the token. Definer so the count and the label are serialised; the
-- ops check inside is what keeps it safe. Raises `not_authorized` (SM403), `not_found` (SM404),
-- `invalid_status` (SM409) or `set_full` (SM409); the action branches on the message.
create or replace function public.approve_peer_company(peer_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  peer public.peer_companies;
  approved_count integer;
  next_label text;
begin
  if caller is null or not private.is_ops() then
    raise exception 'not_authorized' using errcode = 'SM403';
  end if;

  select * into peer from public.peer_companies p where p.id = approve_peer_company.peer_id;
  if not found then
    raise exception 'not_found' using errcode = 'SM404';
  end if;
  if peer.status not in ('proposed', 'retired') then
    raise exception 'invalid_status' using errcode = 'SM409';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(peer.industry_section || '/' || peer.size_band, 0));

  select count(*) into approved_count
  from public.peer_companies p
  where p.industry_section = peer.industry_section
    and p.size_band = peer.size_band
    and p.status = 'approved';
  if approved_count >= 10 then
    raise exception 'set_full' using errcode = 'SM409';
  end if;

  select 'Peer ' || letter into next_label
  from unnest(array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) as letter
  where not exists (
    select 1 from public.peer_companies p
    where p.industry_section = peer.industry_section
      and p.size_band = peer.size_band
      and p.display_label = 'Peer ' || letter
  )
  order by letter
  limit 1;

  update public.peer_companies p
  set status = 'approved',
      display_label = next_label,
      approved_by = caller,
      approved_at = now(),
      rejection_reason = null
  where p.id = peer.id;

  return next_label;
end;
$$;

comment on function public.approve_peer_company(uuid) is 'Ops approve a proposed or retired peer: at most ten per section and band, the next free label Peer A to Peer J (spec 0012).';

revoke execute on function public.approve_peer_company(uuid) from anon, public;
grant execute on function public.approve_peer_company(uuid) to authenticated;

-- When a peer's research run ends, the peer row follows (spec 0012, AC-4, AC-14): succeeded or
-- empty stamps researched_at, stores the run and resets the failure count; a failed run (other
-- than one the trigger call lost) counts one more consecutive failure. A client company is never
-- in peer_companies, so the update touches no row for a client run.
create or replace function private.sync_peer_research()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('succeeded', 'empty') then
    update public.peer_companies p
    set researched_at = coalesce(new.finished_at, now()),
        last_run_id = new.id,
        failed_refreshes = 0
    where p.company_id = new.company_id;
  elsif new.status = 'failed' and new.error_code is distinct from 'trigger_failed' then
    update public.peer_companies p
    set failed_refreshes = p.failed_refreshes + 1,
        last_run_id = new.id
    where p.company_id = new.company_id;
  end if;
  return null;
end;
$$;

revoke execute on function private.sync_peer_research() from public;

create trigger research_runs_sync_peer
  after update of status on public.research_runs
  for each row execute function private.sync_peer_research();
