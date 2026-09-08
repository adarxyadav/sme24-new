-- Local and staging seed: one user per role plus a second client, and one organization per
-- client so cross tenant checks are possible by hand and in end to end tests.
-- Password for every user: sme24-local-password
-- The profiles trigger copies app_metadata.role, full_name and locale into public.profiles; the
-- membership trigger sets each client's current organization.
-- Runs automatically on `supabase db reset`; apply by hand on staging once (never on prod).

create extension if not exists pgcrypto with schema extensions;

-- This file is documented as "apply by hand on staging once, never on prod". Make that
-- enforceable rather than advisory: refuse when the database already holds a user that is not one
-- of the four seed accounts, which is what a real environment looks like. `supabase db reset`
-- runs against an empty database, so the local path is unaffected.
do $$
begin
  if exists (
    select 1 from auth.users
    where id not in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444')
  ) then
    raise exception 'refusing to seed: this database already holds non seed users';
  end if;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'client@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"client"}',
    '{"full_name":"Clara Client","locale":"de","terms_accepted_at":"2026-09-01T08:00:00Z"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'expert@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"expert"}',
    -- The consent stamp is seeded like the client accounts': the expert's profile row below is
    -- already `active`, and the AC-4 gate sends an expert without consent to onboarding, so a
    -- seeded expert missing it would loop on the onboarding page instead of reaching the area.
    '{"full_name":"Erik Expert","locale":"de","terms_accepted_at":"2026-09-01T08:00:00Z"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'ops@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"ops"}',
    '{"full_name":"Olivia Ops","locale":"en"}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
    'authenticated', 'authenticated', 'client2@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"client"}',
    '{"full_name":"Bruno Beispiel","locale":"de","terms_accepted_at":"2026-09-01T08:00:00Z"}', now(), now(), '', '', '', ''
  )
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id, u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email in ('client@example.com', 'expert@example.com', 'ops@example.com', 'client2@example.com')
on conflict (provider_id, provider) do nothing;

-- One organization per client, with fixed ids for local and staging (spec 0002, AC-8).
insert into public.organizations (id, name, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Musterfirma AG', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beispiel GmbH', '44444444-4444-4444-8444-444444444444')
on conflict (id) do nothing;

-- Owner memberships; the trigger sets profiles.organization_id from these.
insert into public.organization_members (organization_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'owner')
on conflict (organization_id, user_id) do nothing;

-- The seeded expert already has a profile row, `active` and onboarded (spec 0012, AC-1). Without
-- it the expert layout would send expert@example.com to onboarding on every sign in, and the four
-- test accounts have to stay usable without going through an invite. The lists are filled so the
-- ops list, the profile form and the client card all have something to show locally.
insert into public.expert_profiles (
  expert_id, email, status, headline, bio, competencies, industries, standards, languages,
  regions, availability, years_experience, phone, invited_at, onboarded_at
)
values (
  '22222222-2222-4222-8222-222222222222',
  'expert@example.com',
  'active',
  'Sicherheitsingenieur mit Schwerpunkt Maschinenbau',
  'Über 15 Jahre Erfahrung in der Arbeitssicherheit produzierender Betriebe in der Deutschschweiz. Begleitet ISO 45001 Zertifizierungen und EKAS 6508 Umsetzungen.',
  array['compliance', 'management_system'],
  array['C', 'F'],
  array['iso_45001', 'ekas_6508', 'suva_asa'],
  array['de', 'en'],
  array['ZH', 'AG', 'ZG'],
  'available',
  15,
  '+41 44 000 00 00',
  now(),
  now()
)
on conflict (expert_id) do nothing;
