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
select plan(34);

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
-- Spec 0011 adds three: packages and stripe_events are keyed on `key` and `event_id` rather than
-- `id`, which private.audit_row() requires for audit_log.row_id (the same reason kpi_definitions
-- and benchmark_assumptions are exceptions), and order_events is itself the append only history
-- of public.orders, so auditing it would only duplicate rows the audit log already holds.
create function pg_temp.audited_tables()
returns setof name language sql stable as $$
  select t from pg_temp.public_tables() t
  where t not in ('audit_log', 'kpi_definitions', 'scaffold_checks', 'email_deliveries', 'notifications', 'benchmarks', 'benchmark_assumptions', 'packages', 'stripe_events', 'order_events')
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
-- tgtype 29 = for each row (1) after insert (4), delete (8) and update (16). enquiries (spec 0009,
-- kind I) is the recorded exception: after insert or update of status, ops_note only (tgtype 21),
-- because the purge's ip_hash null out and its deletes are logged by the task, not audited.
select is_empty(
  $$ select g.tgname from pg_trigger g
     join pg_proc p on p.oid = g.tgfoid
     join pg_namespace pn on pn.oid = p.pronamespace
     where pn.nspname = 'private' and p.proname = 'audit_row' and not g.tgisinternal
       and g.tgtype <> 29 and g.tgname <> 'enquiries_audit' $$,
  'every audit trigger fires after insert, update and delete for each row');
select is(
  (select g.tgtype from pg_trigger g where g.tgname = 'enquiries_audit' and not g.tgisinternal),
  21::smallint, 'the enquiries audit trigger fires after insert and after update of status and ops_note only');
select is_empty(
  $$ select c.relname from pg_trigger g
     join pg_class c on c.oid = g.tgrelid
     join pg_proc p on p.oid = g.tgfoid
     join pg_namespace pn on pn.oid = p.pronamespace
     where pn.nspname = 'private' and p.proname = 'audit_row' and not g.tgisinternal
       and c.relname in ('audit_log', 'kpi_definitions', 'scaffold_checks', 'email_deliveries', 'notifications', 'benchmarks', 'benchmark_assumptions', 'packages', 'stripe_events', 'order_events') $$,
  'audit_log, kpi_definitions, scaffold_checks, email_deliveries, notifications, benchmarks, benchmark_assumptions, packages, stripe_events and order_events are not audited');
-- private.audit_row() writes row_id (not null) from the `id` column, falling back to a single
-- column primary key when the table has no `id` (spec 0012: expert_profiles and expert_ops_notes
-- are keyed on expert_id). So an audited table needs one or the other, and a composite key with
-- no `id` column would write a null row_id: that is what this catches.
select is_empty(
  $$ select t from pg_temp.audited_tables() t
     where not exists (
       select 1 from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(t))::regclass and a.attname = 'id' and not a.attisdropped)
       and not exists (
         select 1 from pg_index i
         where i.indrelid = ('public.' || quote_ident(t))::regclass and i.indisprimary and i.indnatts = 1) $$,
  'every audited table has an id column or a single column primary key for audit_log.row_id');

-- organization_id on kind T tables -------------------------------------------------------
-- Kind T is every table with an organization_id column other than profiles (kind U, nullable
-- current organization), audit_log (kind I, no foreign key so the trail outlives the tenant),
-- email_deliveries (kind I, spec 0006: the organization is a nullable reference for the ops view),
-- notifications (kind U, spec 0006: owned by recipient_id, the organization is a reference) and
-- enquiries (kind I, spec 0009: a signed in client's enquiry references their organization for the
-- ops view, set null on delete).
create function pg_temp.tenant_tables()
returns setof name language sql stable as $$
  select c.relname
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and a.attname = 'organization_id' and not a.attisdropped
    and c.relname not in ('profiles', 'audit_log', 'email_deliveries', 'notifications', 'enquiries')
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
-- Security definer stays inside private, plus the seven public entry points that need it:
-- create_organization (the only insert path for organizations), add_organization_member (the only
-- member facing insert path for memberships, which has to read the target's profile to check they
-- consented) and handle_new_user (the auth trigger from spec 0001 that writes profiles as
-- supabase_auth_admin) and accept_terms (spec 0005: the only API write path for the consent column,
-- which sits outside the authenticated update grant) and settle_order (spec 0011: the atomic
-- settlement, which writes orders and invoices, and no app role may write either; execute is
-- revoked from anon and authenticated, so only the service role reaches it) and
-- next_order_reference (spec 0011: the order reference sequence is not granted to the app roles,
-- and a burnt reference costs nothing, unlike an invoice number, so clients may draw one) and
-- issue_invoice (spec 0011: the bank transfer path's invoice, drawn in the same small transaction;
-- service role only, like settle_order) and the three of spec 0012: set_expert_status (the whole
-- expert status state machine, whose columns sit outside the authenticated update grant),
-- set_expert_photo (same, for the storage path, and it pins the path to the caller's own folder)
-- and assigned_organization_contacts (the client contacts an assigned expert may see, definer
-- because the email lives in auth.users, which no app role may read; it raises not_assigned for
-- any other caller).
select results_eq(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef order by 1 $$,
  $$ values ('accept_terms'::name), ('add_organization_member'::name), ('assigned_organization_contacts'::name), ('create_organization'::name), ('handle_new_user'::name), ('issue_invoice'::name), ('next_order_reference'::name), ('set_expert_photo'::name), ('set_expert_status'::name), ('settle_order'::name) $$,
  'the only security definer functions in public are the ten recorded entry points');
-- settle_order writes money rows, so its execute grant is checked explicitly: the service role
-- only. Supabase's default privileges grant execute to anon and authenticated on every new public
-- function, and the declarative diff's REVOKE ... FROM PUBLIC does not remove those direct grants,
-- so the migration revokes them by hand (AGENTS.md). This assertion is what catches a regression.
select is_empty(
  $$ select r.rolname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) a
     join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and p.proname in ('settle_order', 'scor_reference', 'issue_invoice')
       and a.privilege_type = 'EXECUTE' and r.rolname in ('anon', 'authenticated') $$,
  'no app role may execute settle_order, scor_reference or issue_invoice');
select is_empty(
  $$ select r.rolname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(p.proacl) a
     join pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and p.proname = 'next_order_reference'
       and a.privilege_type = 'EXECUTE' and r.rolname = 'anon' $$,
  'an anonymous visitor cannot draw an order reference');
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
-- Every view runs with security_invoker on, so the caller's policies apply, with one recorded
-- exception: assigned_expert_summaries (spec 0012) is deliberately a definer view, because a
-- client may see the summary of an expert whose expert_profiles row their own policies hide.
-- The where clause in the view body is the access boundary instead, and it is proved row by row
-- in assigned_expert_summaries.test.sql. The exception is named here rather than allowed by a
-- pattern, so a second definer view has to argue its own case.
select results_eq(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and (c.reloptions is null or not c.reloptions @> array['security_invoker=true'])
     order by 1 $$,
  $$ values ('assigned_expert_summaries'::name) $$,
  'assigned_expert_summaries is the only definer view in public; every other view runs as the caller');
-- Realtime membership is an explicit decision per table (spec 0001), so this list is by hand.
-- A new table is not silently in or out: it has to be added here or to realtime_optional below.
select results_eq(
  $$ select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1 $$,
  $$ values ('benchmark_snapshots'::name), ('email_deliveries'::name), ('research_runs'::name), ('scaffold_checks'::name) $$,
  'benchmark_snapshots, email_deliveries, research_runs and scaffold_checks are the tables in supabase_realtime');
-- Tables deliberately outside the publication. A table that is on neither list fails, so the
-- decision is forced rather than defaulted. The five checkout tables of spec 0011 are all out:
-- the order detail page polls a pending card order for up to 60 seconds while the webhook lands
-- (AC-5) rather than subscribing, because the wait is short, bounded and happens on one page, and
-- because orders and invoices carry billing data that has no business on a realtime channel.
-- The two expert tables of spec 0012 are out for the same kind of reason: a profile edit and an
-- ops assignment are both slow, deliberate acts whose reader is already reloading the page, and
-- expert_ops_notes carries record check notes that must never reach a channel a client could join.
create function pg_temp.realtime_optional()
returns setof name language sql stable as $$
  values ('audit_log'::name), ('benchmark_assumptions'), ('benchmarks'), ('companies'), ('company_kpis'), ('enquiries'), ('expert_assignments'),
         ('expert_ops_notes'), ('expert_profiles'), ('invoices'), ('kpi_definitions'), ('notifications'), ('order_events'), ('orders'),
         ('organization_members'), ('organizations'), ('packages'), ('profiles'), ('stripe_events')
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
