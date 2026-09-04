-- The tenant table contract (spec 0002, "Every later table"): what every table shipped by a
-- later slice must keep true. Read from the catalogs, so a new table is checked the moment it
-- exists; the only names written by hand are the deliberate exceptions the spec records
-- (kind I audit_log, kind G kpi_definitions, the spec 0001 scaffold table, kind U profiles).
-- Sanity counts sit next to each catalog sweep so an empty result can never pass by accident
-- (spec 0002 AC-1, AC-3, AC-5, AC-10).
--
-- What this file checks: structure (RLS on, audit trigger, organization_id shape, search_path,
-- security_invoker views, realtime membership, grants) and, in the policy section, that every
-- tenant table carries policies whose expressions actually name the tenant. The policy checks are
-- text level over pg_get_expr, so they prove a policy mentions the tenancy predicate, not that it
-- composes it correctly: a policy naming organization_id in a wrong way still passes here. Per
-- table behaviour under a real token is what the twelve sibling test files are for; this file
-- exists so a table that never got a policy at all cannot reach them unnoticed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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
-- Security definer stays inside private, plus the three public entry points that need it:
-- create_organization (the only insert path for organizations), add_organization_member (the only
-- member facing insert path for memberships, which has to read the target's profile to check they
-- consented) and handle_new_user (the auth trigger from spec 0001 that writes profiles as
-- supabase_auth_admin).
select results_eq(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef order by 1 $$,
  $$ values ('add_organization_member'::name), ('create_organization'::name), ('handle_new_user'::name) $$,
  'the only security definer functions in public are the three recorded entry points');
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
-- A new table is not silently in or out: it has to be added here or to realtime_optional below.
select results_eq(
  $$ select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1 $$,
  $$ values ('research_runs'::name), ('scaffold_checks'::name) $$,
  'research_runs and scaffold_checks are the tables in supabase_realtime');
-- Tables deliberately outside the publication. A table that is on neither list fails, so the
-- decision is forced rather than defaulted.
create function pg_temp.realtime_optional()
returns setof name language sql stable as $$
  values ('audit_log'::name), ('companies'), ('company_kpis'), ('expert_assignments'),
         ('kpi_definitions'), ('organization_members'), ('organizations'), ('profiles')
$$;
select is_empty(
  $$ select t from pg_temp.public_tables() t
     where t not in (select * from pg_temp.realtime_optional())
       and t not in (select tablename from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public') $$,
  'every table records a realtime decision, in the publication or on the recorded exception list');
select is_empty(
  $$ select t from pg_temp.public_tables() t
     where exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'updated_at' and not a.attisdropped)
       and not exists (
         select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
         where g.tgrelid = ('public.' || quote_ident(t))::regclass and not g.tgisinternal
           and pn.nspname = 'public' and p.proname = 'set_updated_at'
           and g.tgtype = 19) $$,
  'every table with an updated_at column has a before update row trigger on set_updated_at');

-- Grants ------------------------------------------------------------------------------------
select is_empty(
  $$ select r || ' ' || p from unnest(array['anon', 'authenticated', 'service_role']) r
     cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
     where has_table_privilege(r, 'public.audit_log', p) $$,
  'anon, authenticated and service_role have no insert, update, delete or truncate on audit_log');
-- TRUNCATE is not filtered by RLS and fires no row trigger, so it would wipe every tenant at once
-- with nothing in the audit log. Supabase's default privileges grant it on every new table, so
-- the sweep covers all of public rather than audit_log alone.
select is_empty(
  $$ select r || ' ' || t from unnest(array['anon', 'authenticated', 'service_role']) r
     cross join pg_temp.public_tables() t
     where has_table_privilege(r, ('public.' || quote_ident(t))::regclass::text, 'TRUNCATE') $$,
  'no app role holds truncate on any table in public');
-- The other write verbs are deliberately left to RLS rather than revoked: no policy grants them
-- to anon, so a write is filtered to zero rows instead of raising, which is the behaviour the per
-- table suites assert. TRUNCATE is the exception above because RLS cannot filter it at all.

-- Policies -----------------------------------------------------------------------------------
-- The structural checks above cannot tell a correct policy from `using (true)`, so these read the
-- policy expressions themselves. A table with RLS on and no policy is invisible rather than leaky,
-- but it is still a mistake, and it is the shape a half finished slice ships.
create function pg_temp.tenant_policies()
returns table (tbl name, polname name, cmd "char", qual text, withcheck text)
language sql stable as $$
  select c.relname, p.polname, p.polcmd,
         pg_get_expr(p.polqual, p.polrelid),
         pg_get_expr(p.polwithcheck, p.polrelid)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname in (select * from pg_temp.tenant_tables())
$$;

select cmp_ok((select count(*) from pg_temp.tenant_policies()), '>=', 15::bigint,
  'the policy sweep sees the policies of the five kind T tables');
select is_empty(
  $$ select t from pg_temp.tenant_tables() t
     where not exists (select 1 from pg_temp.tenant_policies() p where p.tbl = t) $$,
  'every kind T table carries at least one policy');
-- Every tenancy predicate resolves the tenant one of three ways: the organization_id column, the
-- assigned expert helper, or the ops bypass. A policy naming none of them is not a tenant policy.
select is_empty(
  $$ select tbl || '.' || polname from pg_temp.tenant_policies()
     where coalesce(qual, withcheck) is not null
       and coalesce(qual, '') !~ 'organization_id|is_assigned_expert|is_ops|auth\.uid'
       and coalesce(withcheck, '') !~ 'organization_id|is_assigned_expert|is_ops|auth\.uid' $$,
  'every policy on a kind T table names organization_id, a tenancy helper or auth.uid()');
-- `using (true)` on a tenant table reads every tenant's rows. kpi_definitions is the recorded
-- exception (kind G, global reference data) and is not in the tenant sweep.
select is_empty(
  $$ select tbl || '.' || polname from pg_temp.tenant_policies()
     where qual = 'true' or withcheck = 'true' $$,
  'no policy on a kind T table has a literal true qualifier');
-- A select policy is where a read leak lives, so every kind T table must have one and it must
-- filter on the tenant. polcmd 'r' is SELECT, '*' is ALL.
select is_empty(
  $$ select t from pg_temp.tenant_tables() t
     where not exists (
       select 1 from pg_temp.tenant_policies() p
       where p.tbl = t and p.cmd in ('r', '*')
         and p.qual ~ 'organization_id|is_assigned_expert|is_ops') $$,
  'every kind T table has a select policy filtering on the tenant');
-- An insert or update policy without a with check writes any row the using clause let through.
select is_empty(
  $$ select tbl || '.' || polname from pg_temp.tenant_policies()
     where cmd in ('a', 'w', '*') and withcheck is null $$,
  'every insert, update and all policy on a kind T table has a with check');

select * from finish();
rollback;
