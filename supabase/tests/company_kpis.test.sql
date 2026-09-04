-- company_kpis: research rows come from the task, members write only their own client rows,
-- company_kpi_current prefers the client row over the newest research row, assigned experts
-- and ops read (spec 0002 AC-3, AC-4, AC-5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- The suite assumes a database freshly reset (`pnpm db:reset`): it inserts fixtures with fixed
-- keys and counts rows globally. Fail with a clear message rather than a bad plan when a probe
-- left rows behind.
do $$
begin
  if exists (select 1 from public.organizations
             where id not in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
     or exists (select 1 from public.companies)
     or exists (select 1 from public.company_kpis)
     or exists (select 1 from public.research_runs)
     or exists (select 1 from public.kpi_definitions) then
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

-- Fixtures: two organizations with an owner each, an expert assigned to A, ops, a company in each.
select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('a0000000-0000-4000-8000-000000000002', 'a-member@test.local', 'client');
select pg_temp.make_user('b0000000-0000-4000-8000-000000000001', 'b-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');

insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000000', 'Org B', 'b0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'owner');
insert into public.expert_assignments (organization_id, expert_id, assigned_by) values
  ('0a000000-0000-4000-8000-000000000000', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001');
insert into public.companies (id, organization_id, name, created_by) values
  ('0c000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000000', 'Company A', 'a0000000-0000-4000-8000-000000000001'),
  ('0c000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-000000000000', 'Company B', 'b0000000-0000-4000-8000-000000000001');
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better');

insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'succeeded');

-- The task writes research rows
select pg_temp.as_service_role();
select lives_ok(
  $$ insert into public.company_kpis (id, organization_id, company_id, research_run_id, kpi_key, period_year, value, source, confidence, sources)
     values ('0f000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-000000000001', 'ltifr', 2025, 3.2, 'research', 0.8, '[{"url":"https://example.com","title":"Report","excerpt":"…","retrieved_at":"2026-09-01T00:00:00Z"}]') $$,
  'the service key inserts a research row');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, research_run_id, kpi_key, period_year, value, source)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-000000000001', 'ltifr', 2025, 3.3, 'research') $$,
  '23505', null, 'one row per run, KPI and year');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, confidence)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2024, 1, 'research', 1.5) $$,
  '23514', null, 'confidence stays between 0 and 1');

-- Member of A
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select value from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a' and kpi_key = 'ltifr' and period_year = 2025), 3.2,
  'without a client row the current value is the research value');
select lives_ok(
  $$ insert into public.company_kpis (id, organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0f000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2025, 2.5, 'client', 'a0000000-0000-4000-8000-000000000002') $$,
  'a member inserts a client row for their company');
select is((select value from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a' and kpi_key = 'ltifr' and period_year = 2025), 2.5,
  'the client row wins in company_kpi_current');
select is((select count(*) from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a'), 1::bigint,
  'one current row per company, KPI and year');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2025, 2.6, 'client', 'a0000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'a second client row for the same company, KPI and year is rejected');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2024, 2.6, 'research', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot insert a research row');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2024, 2.6, 'client', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a member cannot name someone else as created_by');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0b000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'ltifr', 2024, 2.6, 'client', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot insert into another organization');
select throws_ok(
  $$ insert into public.company_kpis (organization_id, company_id, kpi_key, period_year, value, source, created_by)
     values ('0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000b', 'ltifr', 2024, 2.6, 'client', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot name another organization''s company under their own organization');
select lives_ok($$ update public.company_kpis set value = 2.4 where id = '0f000000-0000-4000-8000-000000000002' $$,
  'a member updates their client row');
-- The row's identity never moves. Without this the update policy would let a member repoint
-- company_id at another organization's company, leaving organization_id and company_id
-- disagreeing: no read leak today, but any later join from company to KPI would make it one.
select throws_ok(
  $$ update public.company_kpis set company_id = '0c000000-0000-4000-8000-00000000000b'
     where id = '0f000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'a member cannot repoint their client row at another organization''s company');
select throws_ok(
  $$ update public.company_kpis set organization_id = '0b000000-0000-4000-8000-000000000000'
     where id = '0f000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'a member cannot move their client row to another organization');
select is(pg_temp.affected($$ update public.company_kpis set value = 0 where id = '0f000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a member cannot update a research row (zero rows)');
select is(pg_temp.affected($$ delete from public.company_kpis where id = '0f000000-0000-4000-8000-000000000001' $$), 0::bigint,
  'a member cannot delete a research row (zero rows)');
select lives_ok($$ delete from public.company_kpis where id = '0f000000-0000-4000-8000-000000000002' $$,
  'a member deletes their client row');
select is((select value from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a' and kpi_key = 'ltifr' and period_year = 2025), 3.2,
  'the research value is current again');

-- Other roles
select pg_temp.impersonate('b0000000-0000-4000-8000-000000000001', 'client', '0b000000-0000-4000-8000-000000000000');
select is((select count(*) from public.company_kpi_current), 0::bigint, 'a member of B sees nothing of A through the view');
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.company_kpis), 1::bigint, 'the assigned expert reads A''s KPI rows');

-- Among research rows the newest wins; a client row wins even over a newer research row.
-- now() is constant inside one transaction, so created_at is set by hand on both rows.
select pg_temp.as_service_role();
insert into public.research_runs (id, organization_id, company_id, status) values
  ('0d000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'succeeded');
insert into public.company_kpis (id, organization_id, company_id, research_run_id, kpi_key, period_year, value, source, created_at)
  values ('0f000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-000000000002', 'ltifr', 2025, 4.1, 'research', now() + interval '1 day');
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000002', 'client', '0a000000-0000-4000-8000-000000000000');
select is((select value from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a' and kpi_key = 'ltifr' and period_year = 2025), 4.1,
  'without a client row the newest research row is current');
insert into public.company_kpis (id, organization_id, company_id, kpi_key, period_year, value, source, created_by, created_at)
  values ('0f000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000000', '0c000000-0000-4000-8000-00000000000a', 'ltifr', 2025, 2.0, 'client', 'a0000000-0000-4000-8000-000000000002', now() - interval '1 day');
select is((select value from public.company_kpi_current where company_id = '0c000000-0000-4000-8000-00000000000a' and kpi_key = 'ltifr' and period_year = 2025), 2.0,
  'the client row wins over a newer research row');

-- Audit
select pg_temp.as_postgres();
select results_eq(
  $$ select actor_role, action from public.audit_log where table_name = 'company_kpis' and row_id = '0f000000-0000-4000-8000-000000000002' order by id $$,
  $$ values ('client', 'insert'), ('client', 'update'), ('client', 'delete') $$,
  'the member''s insert, update and delete are each audited once');

select * from finish();
rollback;
