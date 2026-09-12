-- directory_reveal, directory_credit_balance and directory_remove_contact (spec 0018, AC-11,
-- AC-15, invariants 2, 3, 8): the debit, the idempotent second call, the refusal at zero, two
-- reveals on a balance of one leaving zero and one unlock, the removal that cascades an unlock
-- and suppresses the hash, and the hash equal to the one Node computes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

insert into public.directory_companies (id, name, name_normalised, country, city) values
  ('d0000000-0000-4000-8000-00000000000a', 'Alpha Werke AG', 'alpha werke ag', 'CH', 'Baar');
insert into public.directory_contacts (id, company_id, first_name, last_name, title, email, phone, mobile, country, city, source_batch, imported_at) values
  ('dc000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a', 'Anna', 'Muster', 'Head of EHS', 'anna.muster@alpha.test', '+41 41 123 45 67', null, 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-00000000000a', 'Beat', 'Beispiel', 'Safety Manager', 'beat.beispiel@alpha.test', null, '+41 79 987 65 43', 'CH', 'Baar', 'test batch', now()),
  ('dc000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-00000000000a', 'Gone', 'Person', 'Former', 'gone@alpha.test', null, null, 'CH', 'Baar', 'test batch', now());
-- One credit, granted by hand (the purchase path is proved in orders.test.sql).
insert into public.directory_credit_entries (expert_id, delta, reason, note) values
  ('e0000000-0000-4000-8000-000000000001', 1, 'grant', 'test grant');

-- ─── The reveal (AC-11) ──────────────────────────────────────────────────────────────────────
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');

select is(public.directory_credit_balance(), 1, 'the balance is the sum of the ledger');
select throws_ok(
  $$ select * from public.directory_reveal('00000000-0000-4000-8000-000000000000') $$,
  'SM404', 'not_found', 'a missing contact is SM404');
select results_eq(
  $$ select email, phone, balance, already_unlocked
     from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$,
  $$ values ('anna.muster@alpha.test', '+41 41 123 45 67', 0, false) $$,
  'a reveal with one credit returns the raw row and a balance of zero');
select results_eq(
  $$ select email, balance, already_unlocked
     from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$,
  $$ values ('anna.muster@alpha.test', 0, true) $$,
  'a second reveal of the same contact returns the row for free (invariant 3)');
select throws_ok(
  $$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000002') $$,
  'SM402', 'insufficient_credits', 'a reveal at zero is refused (invariant 2)');
select is(public.directory_credit_balance(), 0, 'two reveals on a balance of one leave zero');
select is((select count(*) from public.directory_unlocks), 1::bigint,
  'and exactly one unlock');
select is((select count(*) from public.directory_credit_entries where reason = 'unlock'), 1::bigint,
  'and exactly one debit');
select is((select sum(delta) from public.directory_credit_entries)::integer, 0,
  'the ledger sums to zero');
select results_eq(
  $$ select unlocked, email from public.directory_search() where contact_id = 'dc000000-0000-4000-8000-000000000001' $$,
  $$ values (true, 'anna.muster@alpha.test') $$,
  'the search now shows the revealed row unmasked');
select throws_ok(
  $$ select public.directory_credit_balance('e0000000-0000-4000-8000-000000000002') $$,
  'SM403', 'forbidden', 'an expert cannot read another expert''s balance');

-- The other expert has no credits and no unlocks.
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000002', 'expert');
select is(public.directory_credit_balance(), 0, 'another expert starts at zero');
select throws_ok(
  $$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$,
  'SM402', 'insufficient_credits', 'an unlock belongs to the expert who paid, not to every expert');

-- ─── Ops read balances and remove a person (AC-15) ─────────────────────────────────────────
select pg_temp.impersonate('c0000000-0000-4000-8000-000000000001', 'ops');
select is(public.directory_credit_balance('e0000000-0000-4000-8000-000000000001'), 0,
  'ops read an expert''s balance by id');
select throws_ok(
  $$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000002') $$,
  'SM403', 'forbidden', 'ops never reveal through the paid path');
select throws_ok(
  $$ select * from public.directory_remove_contact('gone@alpha.test', 'because') $$,
  'SM400', 'validation', 'a removal needs one of the three reasons');
select results_eq(
  $$ select removed, unlocks_cascaded from public.directory_remove_contact('Gone@Alpha.test', 'data_subject_request') $$,
  $$ values (true, 0) $$,
  'removing a contact nobody unlocked answers removed and zero cascaded');
select is((select email_hash from public.directory_suppressions),
  '24241b3daadcbe071c5aa67e79a627ac4a806eeb297d63c745b4707169b234de',
  'the suppression hash equals the one emailHash computes in Node for the same address');
select is((select reason from public.directory_suppressions), 'data_subject_request',
  'the suppression carries the reason');
select is((select created_by from public.directory_suppressions), 'c0000000-0000-4000-8000-000000000001'::uuid,
  'and the ops actor');
select is((select count(*) from public.directory_contacts where email = 'gone@alpha.test'), 0::bigint,
  'the contact row is gone');
select results_eq(
  $$ select removed, unlocks_cascaded from public.directory_remove_contact('anna.muster@alpha.test', 'ops') $$,
  $$ values (true, 1) $$,
  'removing an unlocked contact reports the unlock it cascaded');
select is((select count(*) from public.directory_unlocks), 0::bigint,
  'the buyer''s unlock cascaded away with the contact');
select is((select unlock_id from public.directory_credit_entries where reason = 'unlock'), null::uuid,
  'the debit stays with its unlock_id set null: no refund (owner decision)');
select results_eq(
  $$ select removed, unlocks_cascaded from public.directory_remove_contact('never.there@alpha.test', 'bounce') $$,
  $$ values (false, 0) $$,
  'a not found email is still suppressed');
select is((select count(*) from public.directory_suppressions), 3::bigint,
  'so the objection lands before the next import (invariant 8)');
select results_eq(
  $$ select removed from public.directory_remove_contact('never.there@alpha.test', 'bounce') $$,
  $$ values (false) $$,
  'suppressing the same address twice is a no op');
select is((select count(*) from public.directory_ops_summary()), 1::bigint,
  'the ops summary lists the one expert with ledger rows');
select results_eq(
  $$ select balance, credits_bought, unlocks from public.directory_ops_summary() $$,
  $$ values (0, 0, 0::bigint) $$,
  'with the balance, the credits bought (grants do not count) and the unlocks left');

-- The revealed row is gone for the buyer too: a reveal now answers not found.
select pg_temp.impersonate('e0000000-0000-4000-8000-000000000001', 'expert');
select throws_ok(
  $$ select * from public.directory_reveal('dc000000-0000-4000-8000-000000000001') $$,
  'SM404', 'not_found', 'a reveal of a removed contact answers not found');

select pg_temp.as_postgres();
select * from finish();
rollback;
