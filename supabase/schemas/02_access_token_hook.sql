-- Custom access token hook: copies profiles.role into the token as app_metadata.role and
-- (feature 3) profiles.organization_id as app_metadata.organization_id when the user has one.
-- Configured in config.toml under [auth.hook.custom_access_token] (and in the hosted
-- project's Auth Hooks settings). The request proxy and the RLS helpers read app_metadata.
-- The top level `role` claim stays `authenticated`, which PostgREST needs.
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

  if user_role is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      (coalesce(claims -> 'app_metadata', '{}'::jsonb) - 'organization_id')
        || jsonb_build_object('role', user_role::text)
        || case
             when user_org is not null then jsonb_build_object('organization_id', user_org::text)
             else '{}'::jsonb
           end,
      true
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
