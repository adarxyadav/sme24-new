-- peer_figures (spec 0021, kind G): every signed in user reads, only ops and migrations write,
-- nobody deletes through the app roles, anon is blocked, the checks and the verified pair hold,
-- the quotient unit carries its denominator and no other unit does (AC-18), the note is a {de, en}
-- pair or null (AC-19), the cascade takes a retired company's figures, and the committed seed
-- holds the first curation, the third launch gate query (AC-2, AC-4, AC-14).
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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

select pg_temp.make_user('a0000000-0000-4000-8000-000000000001', 'a-owner@test.local', 'client');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.organizations (id, name, created_by) values
  ('0a000000-0000-4000-8000-000000000000', 'Org A', 'a0000000-0000-4000-8000-000000000001');
insert into public.organization_members (organization_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'owner');
insert into public.kpi_definitions (key, name, unit, direction) values
  ('ltifr', '{"de":"LTIFR","en":"LTIFR"}', 'per 1M hours', 'lower_is_better'),
  ('trifr', '{"de":"TRIFR","en":"TRIFR"}', 'per 1M hours', 'lower_is_better'),
  ('lost_days_per_incident', '{"de":"Tage","en":"Days"}', 'days', 'lower_is_better'),
  ('iso_45001_certified', '{"de":"ISO","en":"ISO"}', 'yes or no', 'higher_is_better'),
  ('fatalities', '{"de":"Tote","en":"Fatalities"}', 'count', 'lower_is_better')
on conflict (key) do nothing;
insert into public.peer_companies (key, name, country, industry_section, headcount, headcount_year, report_url) values
  ('test-co', 'Test AG', 'CH', 'C', 100, 2025, 'https://example.org');

-- The seed (AC-4): at least three LTIFR and three TRIFR figures per curated section. Counted over
-- readable rows, not verified ones: the verified pair is a curation gate on the way to production
-- (the third launch gate query below), not a property of the committed CSV, which AC-3 lets carry a
-- row whose page no person has read yet. A rate is one of the two rate KPIs, so a section reaching
-- three of either kind can rank a client on that KPI.
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'C' and f.kpi_key = 'ltifr'), '>=', 3::bigint,
  'the seed holds at least three LTIFR figures in manufacturing');
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'C' and f.kpi_key = 'trifr'), '>=', 3::bigint,
  'the seed holds at least three TRIFR figures in manufacturing');
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'F' and f.kpi_key = 'ltifr'), '>=', 3::bigint,
  'the seed holds at least three LTIFR figures in construction');
-- The chart's rows (AC-23): at least three lost days figures in manufacturing and one in
-- construction, verified or not, so the bubble chart has an axis to draw on once they are read.
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'C' and f.kpi_key = 'lost_days_per_incident'), '>=', 3::bigint,
  'the seed holds at least three lost days figures in manufacturing');
select cmp_ok((select count(*) from public.peer_figures f join public.peer_companies c on c.key = f.peer_key
    where c.industry_section = 'F' and f.kpi_key = 'lost_days_per_incident'), '>=', 1::bigint,
  'the seed holds at least one lost days figure in construction');
-- The third launch gate query (AC-14) is asserted as a shape, not a count: an unverified row is
-- invisible to the task, so it can only ever cost a peer. Production must read zero, and the gate
-- query in docs/benchmark.md is what enforces that before a promotion.
select is((select count(*) from public.peer_figures where (verified_at is null) <> (verified_by is null)), 0::bigint,
  'every figure has both halves of the verified pair or neither');
select is((select count(*) from public.peer_figures where unit_as_published = 'per_200k_hours' and value <> value_as_published * 5), 0::bigint,
  'every per 200 000 hours figure is stored times five');
select is((select count(*) from public.peer_figures where unit_as_published in ('per_million_hours', 'days') and value <> value_as_published), 0::bigint,
  'per million hours and days figures are stored as published');
-- A quotient row (AC-18) is the generator's division of the two printed numbers, rounded to one
-- decimal; numeric division here, so the band is the rounding and nothing else.
select is((select count(*) from public.peer_figures where unit_as_published = 'days_over_lost_time_accidents'
    and abs(value - value_as_published / denominator_as_published) > 0.05), 0::bigint,
  'every quotient figure is within 0.05 of its printed numerator over its printed denominator');

-- Shape rules (AC-2), as the superuser so no policy hides them.
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('nobody', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23503', null, 'a figure of an unknown company is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'fatalities', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23514', null, 'a KPI outside the four is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1, 1, 'per_hour', 'employees', 'https://example.org') $$,
  '23514', null, 'an unknown unit is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'everyone', 'https://example.org') $$,
  '23514', null, 'an unknown basis is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_at) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org', now()) $$,
  '23514', null, 'a verified_at without a verified_by is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_by) values ('test-co', 'ltifr', 2024, 1, 1, 'per_million_hours', 'employees', 'https://example.org', 'A. Curator') $$,
  '23514', null, 'a verified_by without a verified_at is rejected');
-- The quotient unit (AC-18): the denominator and the unit come together or not at all, the
-- denominator is positive, and the old four units still insert without one.
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'lost_days_per_incident', 2024, 20.5, 2275, 'days_over_lost_time_accidents', 'employees', 'https://example.org') $$,
  '23514', null, 'the quotient unit without a denominator is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, denominator_as_published, unit_as_published, basis, source_url) values ('test-co', 'lost_days_per_incident', 2024, 12, 12, 3, 'days', 'employees', 'https://example.org') $$,
  '23514', null, 'a denominator on a days figure is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, denominator_as_published, unit_as_published, basis, source_url) values ('test-co', 'lost_days_per_incident', 2024, 20.5, 2275, 0, 'days_over_lost_time_accidents', 'employees', 'https://example.org') $$,
  '23514', null, 'a denominator of zero is rejected');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, denominator_as_published, unit_as_published, basis, source_url, note) values ('test-co', 'lost_days_per_incident', 2024, 20.5, 2275, 111, 'days_over_lost_time_accidents', 'employees', 'https://example.org', '{"en":"365 days per fatality"}'::jsonb) $$,
  '23514', null, 'a note with one language is rejected (AC-19)');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, denominator_as_published, unit_as_published, basis, source_url, note) values ('test-co', 'lost_days_per_incident', 2024, 20.5, 2275, 111, 'days_over_lost_time_accidents', 'employees', 'https://example.org', '{"de":"365 Tage je tödlichen Unfall","en":"365 days charged per fatal accident"}'::jsonb) $$,
  'a quotient figure with its denominator and a two language note is accepted');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'lost_days_per_incident', 2023, 12.5, 12.5, 'days', 'employees', 'https://example.org') $$,
  'a days figure still inserts without a denominator');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'iso_45001_certified', 2024, 1, 1, 'boolean', 'employees', 'https://example.org') $$,
  'a boolean figure still inserts without a denominator');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 1.5, 1.5, 'per_million_hours', 'employees', 'https://example.org') $$,
  'an unverified figure is accepted as work in progress');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url, verified_at, verified_by) values ('test-co', 'ltifr', 2024, 1.2, 1.2, 'per_million_hours', 'employees_and_contractors', 'https://example.org', now(), 'A. Curator') $$,
  'the same company, KPI and year under the other basis is a second row');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'ltifr', 2024, 2, 2, 'per_million_hours', 'employees', 'https://example.org') $$,
  '23505', null, 'a second figure per company, KPI, year and basis is rejected');

-- A client reads and cannot write.
select pg_temp.impersonate('a0000000-0000-4000-8000-000000000001', 'client', '0a000000-0000-4000-8000-000000000000');
select cmp_ok((select count(*) from public.peer_figures), '>=', 2::bigint, 'a client reads the figures');
select throws_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'trifr', 2024, 3, 3, 'per_million_hours', 'employees', 'https://example.org') $$,
  '42501', null, 'a client cannot insert a figure');
select is(pg_temp.affected($$ update public.peer_figures set value = 0 where peer_key = 'test-co' $$), 0::bigint,
  'a client cannot update a figure (zero rows)');
select is(pg_temp.affected($$ delete from public.peer_figures where peer_key = 'test-co' $$), 0::bigint,
  'a client cannot delete a figure (zero rows)');
select throws_ok($$ truncate public.peer_figures $$, '42501', null, 'a client cannot truncate the figures');

select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select cmp_ok((select count(*) from public.peer_figures), '>=', 2::bigint, 'an expert reads the figures');

select pg_temp.as_anon();
select is((select count(*) from public.peer_figures), 0::bigint, 'anon reads nothing');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select lives_ok(
  $$ insert into public.peer_figures (peer_key, kpi_key, period_year, value, value_as_published, unit_as_published, basis, source_url) values ('test-co', 'trifr', 2024, 16, 3.2, 'per_200k_hours', 'employees', 'https://example.org') $$,
  'ops insert a figure');
select lives_ok($$ update public.peer_figures set verified_at = now(), verified_by = 'Ops Curator' where peer_key = 'test-co' and kpi_key = 'trifr' $$,
  'ops verify a figure by filling both columns');
select is(pg_temp.affected($$ delete from public.peer_figures where peer_key = 'test-co' $$), 0::bigint,
  'ops cannot delete a figure through the app role (zero rows)');

-- The cascade (AC-2): retiring a company through the migration path takes its figures.
select pg_temp.as_postgres();
select is((select count(*) from public.peer_figures where peer_key = 'test-co'), 6::bigint, 'the six test figures are there');
delete from public.peer_companies where key = 'test-co';
select is((select count(*) from public.peer_figures where peer_key = 'test-co'), 0::bigint, 'a retired company takes its figures with it');
select is((select count(*) from public.audit_log where table_name in ('peer_figures', 'peer_companies')), 0::bigint,
  'no audit row is written for the peer library');

select * from finish();
rollback;
