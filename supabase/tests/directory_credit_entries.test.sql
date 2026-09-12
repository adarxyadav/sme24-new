-- directory_credit_entries (spec 0018, AC-11, invariants 2 and 4): append only for every app
-- role, the sign follows the reason, a purchase names its order once, and an expert reads only
-- their own rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- The suite assumes a database freshly reset (`pnpm db:reset`). A hand run `pnpm directory:import`
-- against the local stack leaves tens of thousands of rows behind, which sort ahead of the
-- invented ones and make these assertions fail for a reason that has nothing to do with the code.
do $$
begin
  if exists (select 1 from public.directory_contacts)
     or exists (select 1 from public.directory_companies)
     or exists (select 1 from public.directory_imports)
     or exists (select 1 from public.directory_unlocks)
     or exists (select 1 from public.directory_credit_entries)
     or exists (select 1 from public.directory_suppressions) then
    raise exception 'this database holds rows beyond the seed; run `pnpm db:reset` before the tests';
  end if;
end $$;

create function pg_temp.impersonate(user_id uuid, app_role text, org_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
    'sub', user_id, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', app_role, 'organization_id', org_id)))::text, true);
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

create function pg_temp.make_user(user_id uuid, email text, app_role text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', app_role),
    '{}', now(), now());
end $$;

select pg_temp.make_user('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'expert');
select pg_temp.make_user('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'expert');
select pg_temp.make_user('c0000000-0000-4000-8000-000000000001', 'ops@test.local', 'ops');
insert into public.expert_profiles (expert_id, email, status, onboarded_at) values
  ('e0000000-0000-4000-8000-000000000001', 'active-expert@test.local', 'active', now()),
  ('e0000000-0000-4000-8000-000000000002', 'other-expert@test.local', 'active', now());
insert into public.orders (id, buyer_expert_id, credits, package_key, reference, payment_method,
  net_rappen, vat_rate, vat_rappen, gross_rappen, package_name_snapshot, billing_name,
  billing_street, billing_postcode, billing_town, locale, created_by)
values ('0e000000-0000-4000-8000-00000000000e', 'e0000000-0000-4000-8000-000000000001', 50,
  'directory_50', 'SME24-2026-0090', 'card', 9950, 0.081, 806, 10756, '50 credits',
  'Erika Expert', 'Bahnhofstrasse 1', '8001', 'Zurich', 'en', 'e0000000-0000-4000-8000-000000000001');

-- ─── The constraints ────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason, order_id)
     values ('e0000000-0000-4000-8000-000000000001', 50, 'purchase', '0e000000-0000-4000-8000-00000000000e') $$,
  'a purchase row names its order');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason, order_id)
     values ('e0000000-0000-4000-8000-000000000001', 50, 'purchase', '0e000000-0000-4000-8000-00000000000e') $$,
  '23505', null, 'one grant per order, whatever the retries (invariant 4)');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', 50, 'purchase') $$,
  '23514', null, 'a purchase without an order is refused');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', -5, 'grant') $$,
  '23514', null, 'a grant is positive');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', 1, 'unlock') $$,
  '23514', null, 'an unlock is negative');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', 0, 'grant') $$,
  '23514', null, 'a zero delta is never a row');
select lives_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason, note)
     values ('e0000000-0000-4000-8000-000000000002', 5, 'grant', 'goodwill') $$,
  'a goodwill grant needs no order');

-- ─── Append only for every app role, own rows only for an expert ───────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select is((select count(*) from public.directory_credit_entries), 1::bigint,
  'an expert reads their own ledger rows only');
select is((select sum(delta) from public.directory_credit_entries)::integer, 50,
  'and sees their balance in them');
select throws_ok(
  $$ insert into public.directory_credit_entries (expert_id, delta, reason)
     values ('e0000000-0000-4000-8000-000000000001', 500, 'grant') $$,
  '42501', null, 'an expert cannot grant themselves credits');
select throws_ok(
  $$ delete from public.directory_credit_entries $$,
  '42501', null, 'an expert cannot delete a ledger row');

select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select throws_ok(
  $$ update public.directory_credit_entries set delta = 1 $$,
  '42501', null, 'ops cannot rewrite the ledger through the API either');

select pg_temp.as_postgres();
select * from finish();
rollback;
