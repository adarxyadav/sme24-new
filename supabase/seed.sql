-- Local and staging seed: one user per role. Password for all three: sme24-local-password
-- The profiles trigger copies app_metadata.role into public.profiles.
-- Runs automatically on `supabase db reset`; apply by hand on staging once (never on prod).

create extension if not exists pgcrypto with schema extensions;

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
    '{"provider":"email","providers":["email"],"role":"client"}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'expert@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"expert"}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'ops@example.com',
    extensions.crypt('sme24-local-password', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"ops"}', '{}', now(), now(), '', '', '', ''
  )
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id, u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email in ('client@example.com', 'expert@example.com', 'ops@example.com')
on conflict (provider_id, provider) do nothing;
