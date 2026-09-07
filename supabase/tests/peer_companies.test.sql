-- peer_companies (spec 0012): the house organization and its membership guard, the peer row
-- contract (a house company marked is_peer, the label exactly when approved), the approval
-- function under its ten peer cap with label reuse, the two widened reads on companies and
-- company_kpis, the house branch of the research quota, the research run sync trigger and the
-- audit trail (AC-1, AC-3, AC-5, AC-7, AC-14).
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally. Fail with a clear message rather than a bad plan when a probe
-- left rows behind.
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.company_kpis)
     or exists (select 1 from public.research_runs)
     or exists (select 1 from public.peer_companies) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;

-- Shared shape (spec 0002, Policy tests): everything below runs in one transaction and is rolled
-- back at the end, so nothing survives. Impersonation switches the role and the JWT claims the
-- way PostgREST does; `pg_temp.as_postgres()` returns to the superuser between scenarios.
create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
end $$;

create function pg_temp.as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create function pg_temp.as_service_role()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A minimal auth user; the profiles trigger creates the profile from app_metadata.role.
create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

-- Runs a write as the current role and returns the number of rows it touched: the way to show
-- that a policy filtered every row (zero rows, no error) rather than raised.
create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- A peer company in the house organization with its peer row, keyed by a small number.
create function pg_temp.make_peer(n integer, section text default 'C', band text default '50-249')
returns uuid language plpgsql as $$
declare company uuid := ('0f000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid;
begin
  insert into public.companies (id, organization_id, name, legal_name, is_peer)
  values (company, '99999999-9999-4999-8999-999999999999', 'Peer ' || n, 'Peer ' || n || ' AG', true);
  insert into public.peer_companies (id, company_id, industry_section, size_band, proposed_by)
  values (('0e000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, company, section, band, 'ops');
  return company;
end $$;

-- Fixtures: two client organizations with an owner each, an expert assigned to A, ops, a company in each.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_assignments (organization_id, expert_id, assigned_by) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better')
on conflict (key) do nothing;

-- The house organization (AC-1) ------------------------------------------------------------
select is((select name from public.organizations where id = private.house_organization_id()), 'SME24 peer research',
  'the house organization is seeded with its fixed id');
select is((select count(*) from public.organization_members where organization_id = private.house_organization_id()), 0::bigint,
  'the house organization has no members');
select throws_ok(
  $$ insert into public.organization_members (organization_id, user_id, role)
     values ('99999999-9999-4999-8999-999999999999', 'a0000000-0000-4000-8000-000000000001', 'member') $$,
  '23514', null, 'a membership of the house organization is refused');

-- The peer row contract ----------------------------------------------------------------------
select throws_ok(
  $$ insert into public.peer_companies (company_id, industry_section, size_band, proposed_by)
     values ('0c000000-0000-4000-8000-00000000000a', 'C', '50-249', 'ops') $$,
  '23514', null, 'a client company can never become a peer');
insert into public.companies (id, organization_id, name) values
  ('0f000000-0000-4000-8000-0000000000ff', '99999999-9999-4999-8999-999999999999', 'House company without the mark');
select throws_ok(
  $$ insert into public.peer_companies (company_id, industry_section, size_band, proposed_by)
     values ('0f000000-0000-4000-8000-0000000000ff', 'C', '50-249', 'ops') $$,
  '23514', null, 'a house company not marked is_peer cannot become a peer');
select is((select is_peer from public.companies where id = '0c000000-0000-4000-8000-00000000000a'), false,
  'is_peer defaults to false');
select pg_temp.make_peer(1);
select pg_temp.make_peer(2);
select pg_temp.make_peer(3);
select is((select status from public.peer_companies where id = '0e000000-0000-4000-8000-000000000001'), 'proposed',
  'a new peer starts proposed');
select throws_ok(
  $$ update public.peer_companies set display_label = 'Peer A' where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a proposed peer cannot carry a label');
select throws_ok(
  $$ update public.peer_companies set status = 'approved', approved_at = now() where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an approved peer without a label is refused');
select throws_ok(
  $$ update public.peer_companies set status = 'approved', display_label = 'Peer Z', approved_at = now() where id = '0e000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a label outside Peer A to Peer J is refused');

-- Approval (AC-3) ----------------------------------------------------------------------------
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok($$ select public.approve_peer_company('0e000000-0000-4000-8000-000000000001') $$,
  'SM403', 'not_authorized', 'a client cannot approve a peer');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select public.approve_peer_company('0e000000-0000-4000-8000-000000000001')), 'Peer A',
  'ops approve the first peer and it becomes Peer A');
select results_eq(
  $$ select status, display_label, approved_by, approved_at is not null from public.peer_companies where id = '0e000000-0000-4000-8000-000000000001' $$,
  $$ values ('approved', 'Peer A', 'c0000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'approval stamps the status, the label, the approver and the time');
select throws_ok($$ select public.approve_peer_company('0e000000-0000-4000-8000-000000000001') $$,
  'SM409', 'invalid_status', 'approving an approved peer is refused');
select throws_ok($$ select public.approve_peer_company('0e000000-0000-4000-8000-0000000000ee') $$,
  'SM404', 'not_found', 'an unknown peer is not found');
select is((select public.approve_peer_company('0e000000-0000-4000-8000-000000000002')), 'Peer B',
  'the second approval takes the next label');
select pg_temp.as_postgres();
select pg_temp.make_peer(n) from generate_series(4, 11) n;
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is(
  (select count(*) from (select public.approve_peer_company(('0e000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid) from generate_series(3, 10) n) approved),
  8::bigint, 'ops approve eight more peers up to ten');
select is((select count(distinct display_label) from public.peer_companies where status = 'approved'), 10::bigint,
  'ten approved peers carry ten distinct labels');
select throws_ok($$ select public.approve_peer_company('0e000000-0000-4000-8000-000000000011') $$,
  'SM409', 'set_full', 'the eleventh approval in a section and band is refused');
select lives_ok(
  $$ update public.peer_companies set status = 'retired', display_label = null where id = '0e000000-0000-4000-8000-000000000003' $$,
  'ops retire a peer, which clears its label');
select is((select public.approve_peer_company('0e000000-0000-4000-8000-000000000011')), 'Peer C',
  'the next approval reuses the freed label');
select pg_temp.as_postgres();
select pg_temp.make_peer(12, 'F', '1-49');
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is((select public.approve_peer_company('0e000000-0000-4000-8000-000000000012')), 'Peer A',
  'another section and band has its own labels');
select throws_ok($$ select public.approve_peer_company('0e000000-0000-4000-8000-000000000003') $$,
  'SM409', 'set_full', 'a retired peer cannot come back into a full set');

-- The widened reads (AC-7) --------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.company_kpis (id, organization_id, company_id, kpi_key, period_year, value, source) values
  ('0d000000-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000001', 'ltifr', 2024, 2.5, 'research'),
  ('0d000000-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000003', 'ltifr', 2024, 3.5, 'research'),
  ('0d000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'ltifr', 2024, 9.9, 'research');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select results_eq(
  $$ select id from public.companies where organization_id = '99999999-9999-4999-8999-999999999999' order by id $$,
  $$ select company_id from public.peer_companies where status = 'approved' order by company_id $$,
  'a client reads exactly the approved peers'' companies');
select is((select count(*) from public.companies where id = '0f000000-0000-4000-8000-000000000003'), 0::bigint,
  'a retired peer''s company is not readable by a client');
select is((select count(*) from public.companies where id = '0c000000-0000-4000-8000-00000000000b'), 0::bigint,
  'another client''s company stays invisible');
select results_eq(
  $$ select id from public.company_kpis order by id $$,
  $$ values ('0d000000-0000-4000-8000-000000000001'::uuid) $$,
  'a client reads the approved peer''s KPI row and neither the retired peer''s nor another client''s');
select is((select count(*) from public.peer_companies), 11::bigint,
  'a client reads the approved peer rows only (ten in C and one in F)');
select is(pg_temp.affected($$ update public.peer_companies set status = 'retired', display_label = null where id = '0e000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a client cannot change a peer row (zero rows)');
select lives_ok(
  $$ insert into public.companies (id, organization_id, name, is_peer) values ('0c000000-0000-4000-8000-0000000000aa', '0a000000-0000-4000-8000-000000000000', 'Marked by a client', true) $$,
  'a client may mark their own company is_peer (the mark alone opens nothing)');
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.companies where id = '0c000000-0000-4000-8000-0000000000aa'), 0::bigint,
  'a client company marked is_peer outside the house organization stays invisible to other clients');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.companies where id = '0f000000-0000-4000-8000-000000000001'), 1::bigint,
  'an expert reads an approved peer too');
select pg_temp.as_anon();
select is((select count(*) from public.companies), 0::bigint, 'anon reads no company');
select is((select count(*) from public.peer_companies), 0::bigint, 'anon reads no peer row');
select ok(not has_function_privilege('anon', 'public.approve_peer_company(uuid)', 'EXECUTE'),
  'anon cannot execute approve_peer_company');

-- The quota branch (AC-5) ---------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.research_runs (organization_id, company_id, status, finished_at)
select '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000001', 'succeeded', now() from generate_series(1, 6);
insert into public.research_runs (organization_id, company_id, status, finished_at)
select '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'succeeded', now() from generate_series(1, 6);
select is((select private.research_run_allowed('99999999-9999-4999-8999-999999999999')), true,
  'the house organization may start a seventh run today');
select is((select private.research_run_allowed('0a000000-0000-4000-8000-000000000000')), false,
  'a client organization may not');
insert into public.research_runs (organization_id, company_id, status, finished_at)
select '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000001', 'succeeded', now() from generate_series(1, 44);
select is((select private.research_run_allowed('99999999-9999-4999-8999-999999999999')), false,
  'the house organization stops at fifty runs in 24 hours');

-- The research run sync (AC-4, AC-14) --------------------------------------------------------
select pg_temp.as_postgres();
insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d100000-0000-4000-8000-000000000001', '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000002', 'queued');
select pg_temp.as_service_role();
update public.research_runs set status = 'running', started_at = now() where id = '0d100000-0000-4000-8000-000000000001';
select is((select researched_at from public.peer_companies where company_id = '0f000000-0000-4000-8000-000000000002'), null,
  'a running run does not stamp researched_at');
update public.research_runs set status = 'succeeded', finished_at = '2026-09-07T10:00:00Z' where id = '0d100000-0000-4000-8000-000000000001';
select results_eq(
  $$ select researched_at, last_run_id, failed_refreshes from public.peer_companies where company_id = '0f000000-0000-4000-8000-000000000002' $$,
  $$ values ('2026-09-07T10:00:00Z'::timestamptz, '0d100000-0000-4000-8000-000000000001'::uuid, 0) $$,
  'a succeeded run stamps researched_at, the run id and resets the failure count');
select pg_temp.as_postgres();
insert into public.research_runs (id, organization_id, company_id, status, started_at) values
  ('0d100000-0000-4000-8000-000000000002', '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000002', 'running', now());
select pg_temp.as_service_role();
update public.research_runs set status = 'failed', error_code = 'provider_unavailable', finished_at = now() where id = '0d100000-0000-4000-8000-000000000002';
select results_eq(
  $$ select researched_at, last_run_id, failed_refreshes from public.peer_companies where company_id = '0f000000-0000-4000-8000-000000000002' $$,
  $$ values ('2026-09-07T10:00:00Z'::timestamptz, '0d100000-0000-4000-8000-000000000002'::uuid, 1) $$,
  'a failed run counts one consecutive failure and keeps researched_at');
select pg_temp.as_postgres();
insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d100000-0000-4000-8000-000000000003', '99999999-9999-4999-8999-999999999999', '0f000000-0000-4000-8000-000000000002', 'queued');
update public.research_runs set status = 'failed', error_code = 'trigger_failed', finished_at = now() where id = '0d100000-0000-4000-8000-000000000003';
select is((select failed_refreshes from public.peer_companies where company_id = '0f000000-0000-4000-8000-000000000002'), 1,
  'a run the trigger call lost does not count as a failure');
insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d100000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'queued');
select lives_ok(
  $$ update public.research_runs set status = 'failed', error_code = 'internal', finished_at = now() where id = '0d100000-0000-4000-8000-00000000000a' $$,
  'a client run ending touches no peer row and raises nothing');

-- Grants and audit ---------------------------------------------------------------------------
select is_empty(
  $$ select r from unnest(array['anon', 'authenticated', 'service_role']) r where has_table_privilege(r, 'public.peer_companies', 'TRUNCATE') $$,
  'no app role holds truncate on peer_companies');
select results_eq(
  $$ select actor_role, action from public.audit_log where table_name = 'peer_companies' and row_id = '0e000000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('system', 'insert'), ('ops', 'update') $$,
  'the fixture insert and the ops approval are each audited once');

select * from finish();
rollback;
