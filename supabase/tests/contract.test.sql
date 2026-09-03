-- The tenant table contract (spec 0002, "Every later table"): what every table shipped by a
-- later slice must keep true. Read from the catalogs, so a new table is checked the moment it
-- exists; the only names written by hand are the deliberate exceptions the spec records
-- (kind I audit_log, kind G kpi_definitions, the spec 0001 scaffold table, kind U profiles).
-- Sanity counts sit next to each catalog sweep so an empty result can never pass by accident
-- (spec 0002 AC-1, AC-3, AC-5, AC-10).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Every table in public (regular and partitioned).
create function pg_temp.public_tables()
returns setof name language sql stable as $$
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
$$;

-- Row level security ----------------------------------------------------------------------
select cmp_ok((select count(*) from pg_temp.public_tables()), '>=', 10::bigint,
  'the catalog sweep sees the ten tables of feature 3');
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'every table in public has row level security enabled');

-- Audit trigger ---------------------------------------------------------------------------
-- Every table except the recorded exceptions carries <table>_audit calling private.audit_row().
create function pg_temp.audited_tables()
returns setof name language sql stable as $$
  select t from pg_temp.public_tables() t
  where t not in ('audit_log', 'kpi_definitions', 'scaffold_checks')
$$;

select cmp_ok((select count(*) from pg_temp.audited_tables()), '>=', 7::bigint,
  'the audited set holds the seven core tables of feature 3');
select is_empty(
  $$ select t from pg_temp.audited_tables() t
     where not exists (
       select 1 from pg_trigger g
       join pg_proc p on p.oid = g.tgfoid
       join pg_namespace pn on pn.oid = p.pronamespace
       where g.tgrelid = ('public.' || quote_ident(t))::regclass
         and not g.tgisinternal
         and g.tgname = t || '_audit'
         and pn.nspname = 'private' and p.proname = 'audit_row') $$,
  'every audited table has a <table>_audit trigger calling private.audit_row()');
-- tgtype 29 = for each row (1) after insert (4), delete (8) and update (16).
select is_empty(
  $$ select g.tgname from pg_trigger g
     join pg_proc p on p.oid = g.tgfoid
     join pg_namespace pn on pn.oid = p.pronamespace
     where pn.nspname = 'private' and p.proname = 'audit_row' and not g.tgisinternal
       and g.tgtype <> 29 $$,
  'every audit trigger fires after insert, update and delete for each row');
select is_empty(
  $$ select c.relname from pg_trigger g
     join pg_class c on c.oid = g.tgrelid
     join pg_proc p on p.oid = g.tgfoid
     join pg_namespace pn on pn.oid = p.pronamespace
     where pn.nspname = 'private' and p.proname = 'audit_row' and not g.tgisinternal
       and c.relname in ('audit_log', 'kpi_definitions', 'scaffold_checks') $$,
  'audit_log, kpi_definitions and scaffold_checks are not audited');
-- private.audit_row() stores subject ->> 'id' as row_id (not null), so an audited table needs one.
select is_empty(
  $$ select t from pg_temp.audited_tables() t
     where not exists (
       select 1 from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'id' and not a.attisdropped) $$,
  'every audited table has an id column for audit_log.row_id');

-- organization_id on kind T tables -------------------------------------------------------
-- Kind T is every table with an organization_id column other than profiles (kind U, nullable
-- current organization) and audit_log (kind I, no foreign key so the trail outlives the tenant).
create function pg_temp.tenant_tables()
returns setof name language sql stable as $$
  select c.relname
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and a.attname = 'organization_id' and not a.attisdropped
    and c.relname not in ('profiles', 'audit_log')
$$;

select cmp_ok((select count(*) from pg_temp.tenant_tables()), '>=', 5::bigint,
  'the tenant sweep sees the five kind T tables of feature 3');
select is_empty(
  $$ select t from pg_temp.tenant_tables() t
     join pg_attribute a on a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'organization_id'
     where not a.attnotnull $$,
  'organization_id is not null on every kind T table');
select is_empty(
  $$ select t from pg_temp.tenant_tables() t
     join pg_attribute a on a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'organization_id'
     where not exists (
       select 1 from pg_constraint k
       where k.conrelid = a.attrelid and k.contype = 'f'
         and k.conkey = array[a.attnum]
         and k.confrelid = 'public.organizations'::regclass
         and k.confkey = array[(select attnum from pg_attribute where attrelid = 'public.organizations'::regclass and attname = 'id')]
         and k.confdeltype = 'c') $$,
  'organization_id on every kind T table references organizations (id) on delete cascade');
select fk_ok('public', 'profiles', 'organization_id', 'public', 'organizations', 'id',
  'profiles.organization_id (kind U) references organizations');
select is_empty(
  $$ select conname from pg_constraint where conrelid = 'public.audit_log'::regclass and contype = 'f' $$,
  'audit_log has no foreign key, so the trail outlives the user and the organization');

-- Functions ------------------------------------------------------------------------------
-- Security definer stays inside private, plus the two public entry points that need it:
-- create_organization (the only insert path for organizations) and handle_new_user (the auth
-- trigger from spec 0001 that writes profiles as supabase_auth_admin).
select results_eq(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef order by 1 $$,
  $$ values ('create_organization'::name), ('handle_new_user'::name) $$,
  'the only security definer functions in public are create_organization and handle_new_user');
select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('private', 'public')
       and (p.proconfig is null or not p.proconfig @> array['search_path=""']) $$,
  'every function in private and public sets search_path to ''''');
select cmp_ok(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private'),
  '>=', 10::bigint, 'the function sweep sees the ten private helpers of feature 3');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no usage on the private schema');
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon cannot execute any private function');
select ok(not has_function_privilege('anon', 'public.create_organization(text)', 'EXECUTE'),
  'anon cannot execute create_organization');

-- Views, realtime, updated_at --------------------------------------------------------------
select has_view('public', 'company_kpi_current', 'company_kpi_current exists');
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and (c.reloptions is null or not c.reloptions @> array['security_invoker=true']) $$,
  'every view in public runs with security_invoker on, so the caller''s policies apply');
-- Realtime membership is an explicit decision per table (spec 0001), so this list is by hand.
select results_eq(
  $$ select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1 $$,
  $$ values ('research_runs'::name), ('scaffold_checks'::name) $$,
  'research_runs and scaffold_checks are the tables in supabase_realtime');
select is_empty(
  $$ select t from pg_temp.public_tables() t
     where exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'updated_at' and not a.attisdropped)
       and not exists (
         select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
         where g.tgrelid = ('public.' || quote_ident(t))::regclass and not g.tgisinternal
           and pn.nspname = 'public' and p.proname = 'set_updated_at'
           and g.tgtype = 19) $$,
  'every table with an updated_at column has a before update row trigger on set_updated_at');

-- Audit log grants -------------------------------------------------------------------------
select is_empty(
  $$ select r || ' ' || p from unnest(array['anon', 'authenticated', 'service_role']) r
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, 'public.audit_log', p) $$,
  'anon, authenticated and service_role have no insert, update, delete or truncate on audit_log');

select * from finish();
rollback;
