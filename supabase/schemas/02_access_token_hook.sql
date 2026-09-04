-- Custom access token hook: copies profiles.role into the token as app_metadata.role and
-- (feature 3) profiles.organization_id as app_metadata.organization_id when the user has one.
-- Configured in config.toml under [auth.hook.custom_access_token] (and in the hosted
-- project's Auth Hooks settings). The request proxy and the RLS helpers read app_metadata.
-- The top level `role` claim stays `authenticated`, which PostgREST needs.
-- Both app_metadata keys are always rewritten from the profile, including when no profile row
-- exists (they are stripped), so nothing a user can influence reaches them.
-- A membership change shows up at the next token refresh (at most jwt_expiry).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  user_role public.app_role;
  user_org uuid;
begin
  select role, organization_id into user_role, user_org
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  -- The hook owns app_metadata.role and app_metadata.organization_id unconditionally: both keys
  -- are stripped first and only written back from the profile. Without the else branch a user
  -- with no profile row would keep whatever the incoming claims carried, and Supabase builds
  -- those from raw_app_meta_data, which sign up can influence: a self supplied role of `ops`
  -- would pass straight through.
  claims := jsonb_set(
    claims,
    '{app_metadata}',
    (coalesce(claims -> 'app_metadata', '{}'::jsonb) - 'role' - 'organization_id')
      || case
           when user_role is not null then jsonb_build_object('role', user_role::text)
           else '{}'::jsonb
         end
      || case
           when user_role is not null and user_org is not null
             then jsonb_build_object('organization_id', user_org::text)
           else '{}'::jsonb
         end,
    true
  );

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
