-- Audit log (spec 0002, kind I). One row per insert, update and delete on every tenant, user
-- scoped, expert owned and access control table, written by the generic row trigger
-- private.audit_row() that each table attaches in its own schema file. Append only: no policy
-- allows a write, insert/update/delete/truncate are revoked from every app role (the trigger
-- inserts as its definer), and private.protect_audit_log() raises on update or delete unless
-- the maintenance setting app.audit_maintenance is 'on' (feature 14's redaction path).
-- No foreign keys on purpose: the trail outlives the user and the organization.
--
-- File order: this sorts before 01_profiles.sql so private.audit_row() exists before the first
-- table attaches it.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid null,
  actor_role text not null check (actor_role in ('client', 'expert', 'ops', 'service', 'system')),
  organization_id uuid null,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_data jsonb null,
  new_data jsonb null,
  changed_columns text[] null
);

comment on table public.audit_log is 'Append only trail of every write on the audited tables. Ops read; nobody updates or deletes outside the maintenance path.';
comment on column public.audit_log.actor_role is 'client, expert or ops from the token; service for the service key; system when there is no token (migrations, seed, auth admin).';

create index audit_log_organization_id_occurred_at_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_table_name_row_id_idx on public.audit_log (table_name, row_id);
create index audit_log_actor_id_occurred_at_idx on public.audit_log (actor_id, occurred_at desc);

alter table public.audit_log enable row level security;

create policy "audit_log: ops read"
  on public.audit_log
  for select
  to authenticated
  using ((select private.is_ops()));

-- Append only for every app role. The trigger inserts as its definer (postgres).
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;

-- Guard against the superuser path as well: only the maintenance setting may change a row.
create or replace function private.protect_audit_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.audit_maintenance', true), '') <> 'on' then
    raise exception 'audit_log is append only';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_audit_log() from public;

create trigger audit_log_protect
  before update or delete on public.audit_log
  for each row execute function private.protect_audit_log();

-- The generic row trigger. Actor and role come from the request claims (null actor and
-- `service` or `system` for tasks and SQL); the organization is the row's organization_id
-- column when the table has one; changed_columns are the keys whose value differs.
create or replace function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  app_role text := claims -> 'app_metadata' ->> 'role';
  row_old jsonb;
  row_new jsonb;
  subject jsonb;
  changed text[];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    row_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    row_new := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
    into changed
    from jsonb_each(row_new) n
    where row_old -> n.key is distinct from n.value;
  end if;
  subject := coalesce(row_new, row_old);

  insert into public.audit_log (
    actor_id, actor_role, organization_id, table_name, row_id, action, old_data, new_data, changed_columns
  )
  values (
    (claims ->> 'sub')::uuid,
    case
      when app_role in ('client', 'expert', 'ops') then app_role
      when claims ->> 'role' = 'service_role' then 'service'
      else 'system'
    end,
    case when subject ? 'organization_id' then (subject ->> 'organization_id')::uuid end,
    tg_table_name,
    subject ->> 'id',
    lower(tg_op),
    row_old,
    row_new,
    changed
  );
  return null;
end;
$$;

revoke execute on function private.audit_row() from public;
