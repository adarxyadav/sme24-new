-- research_peers (spec 0022, kind T, AC-9): a member reads only their own organization's peer
-- rows, a member of another organization gets none, an assigned expert and ops read, no app role
-- may write or truncate, anon reaches nothing, the run cascade takes the rows with the run, and
-- the checks (unit, rung, kpi_key, the per million value) hold.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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

create function pg_temp.make_user(user_id uuid, email text, app_role text, meta jsonb default '{}')
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    meta, now(), now());
end $$;

create function pg_temp.affected(statement text)
returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;

-- Fixtures: two organizations with an owner each, an expert assigned to A, ops, a company and a
-- succeeded research run in each.
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
-- The assignment trigger refuses an expert who is not active; the row is fixture setup only.
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'active', now());
insert into public.expert_assignments (organization_id, expert_id, assigned_by) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better'),
  ('trifr', '{"de":"TRIFR","en":"TRIFR"}', 'per 1M hours', 'lower_is_better')
on conflict (key) do nothing;
insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'succeeded'),
  ('0d000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'succeeded');

-- The task writes through the service client.
select pg_temp.as_service_role();
select lives_ok(
  $$ insert into public.research_peers (id, organization_id, company_id, research_run_id, peer_name, peer_website, peer_country, industry_section, headcount, headcount_year, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, source_title, confidence, rung)
     values ('0e000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer One AG', 'https://peer-one.example', 'CH', 'C', 1200, 2025, 'ltifr', 2025, 6.5, 1.3, 'per_200k_hours', 'employees', 'https://peer-one.example/report.pdf', 'Annual report 2025', 0.8, 'country') $$,
  'the service key inserts a peer row');
select lives_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer One AG', 'CH', 'C', 'trifr', 2025, 11.0, 11.0, 'per_million_hours', 'https://peer-one.example/report.pdf', 0.7, 'country') $$,
  'the same peer takes a second row for its other rate');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer One AG', 'CH', 'C', 'ltifr', 2024, 7.0, 7.0, 'per_million_hours', 'https://peer-one.example/old.pdf', 0.6, 'country') $$,
  '23505', null, 'one row per run, peer and KPI');

-- The checks that keep a stored figure meaningful (AC-8, AC-9).
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'CH', 'C', 'ltifr', 2025, 4.0, 4.0, 'per_1000_fte', 'https://peer-two.example', 0.8, 'country') $$,
  '23514', null, 'a unit outside the three is refused');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'CH', 'C', 'fatalities', 2025, 1, 1, 'per_million_hours', 'https://peer-two.example', 0.8, 'country') $$,
  '23514', null, 'only ltifr and trifr are peer KPIs');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'CH', 'C', 'ltifr', 2025, 4.0, 4.0, 'per_million_hours', 'https://peer-two.example', 0.8, 'europe') $$,
  '23514', null, 'the rung is one of country, region, world');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'Switzerland', 'C', 'ltifr', 2025, 4.0, 4.0, 'per_million_hours', 'https://peer-two.example', 0.8, 'country') $$,
  '23514', null, 'the country is an alpha 2 code, not a name');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'CH', 'Z', 'ltifr', 2025, 4.0, 4.0, 'per_million_hours', 'https://peer-two.example', 0.8, 'country') $$,
  '23514', null, 'the section is a NACE letter A to U');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Peer Two AG', 'CH', 'C', 'ltifr', 2025, 4.0, 4.0, 'per_million_hours', 'https://peer-two.example', 1.4, 'country') $$,
  '23514', null, 'confidence stays between 0 and 1');

-- Org B's own row, so the isolation below compares two populated organizations.
insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
  values ('0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', '0d000000-0000-4000-8000-00000000000b', 'Peer Nine SA', 'FR', 'C', 'ltifr', 2025, 9.0, 9.0, 'per_million_hours', 'https://peer-nine.example', 0.9, 'region');

-- Tenant isolation (AC-9).
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select is(
  (select count(*) from public.research_peers),
  2::bigint,
  'a member reads their own organization''s peer rows');
select is(
  (select count(*) from public.research_peers where organization_id = '0b000000-0000-4000-8000-000000000000'),
  0::bigint,
  'a member never reads another organization''s peer rows');

select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is(
  (select count(*) from public.research_peers),
  1::bigint,
  'a member of another organization sees only their own row');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert', null);
select is(
  (select count(*) from public.research_peers),
  2::bigint,
  'the assigned expert reads the organization''s peer rows');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops', null);
select is(
  (select count(*) from public.research_peers),
  3::bigint,
  'ops read every peer row');

-- anon loses the grant outright rather than being filtered to zero rows by RLS, so the read fails
-- on the privilege: no signed out caller reaches this table by any route.
select pg_temp.as_anon();
select throws_ok(
  $$ select count(*) from public.research_peers $$,
  '42501', null, 'a signed out caller cannot read the table at all');

-- The write verbs are revoked outright, so a member's write fails on the grant rather than only
-- on a missing policy: the error is 42501, not a silently filtered zero rows.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select throws_ok(
  $$ insert into public.research_peers (organization_id, company_id, research_run_id, peer_name, peer_country, industry_section, kpi_key, period_year, value, value_as_published, unit_as_published, source_url, confidence, rung)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000a', 'Made Up AG', 'CH', 'C', 'ltifr', 2025, 0.1, 0.1, 'per_million_hours', 'https://made-up.example', 1.0, 'country') $$,
  '42501', null, 'a member may not insert a peer row');
select throws_ok(
  $$ update public.research_peers set value = 0.1 $$,
  '42501', null, 'a member may not update a peer row');
select throws_ok(
  $$ delete from public.research_peers $$,
  '42501', null, 'a member may not delete a peer row');
select throws_ok(
  $$ truncate public.research_peers $$,
  '42501', null, 'a member may not truncate the table');

select pg_temp.as_service_role();
select throws_ok(
  $$ truncate public.research_peers $$,
  '42501', null, 'not even the service role may truncate the table');

-- The run cascade: a deleted run takes its peers with it, so no row outlives the run that wrote
-- it and the benchmark can never read peers whose provenance is gone.
select pg_temp.as_postgres();
select is(
  pg_temp.affected($$ delete from public.research_runs where id = '0d000000-0000-4000-8000-00000000000a' $$),
  1::bigint,
  'the run is deleted');
select is(
  (select count(*) from public.research_peers where research_run_id = '0d000000-0000-4000-8000-00000000000a'),
  0::bigint,
  'the run cascade took its peer rows');

select * from finish();
rollback;
