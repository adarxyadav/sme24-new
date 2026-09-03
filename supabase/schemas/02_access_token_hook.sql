-- Custom access token hook: copies profiles.role into the token as app_metadata.role.
-- Configured in config.toml under [auth.hook.custom_access_token] (and in the hosted
-- project's Auth Hooks settings). The request proxy reads app_metadata.role from the claims.
-- The top level `role` claim stays `authenticated`, which PostgREST needs.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  user_role public.app_role;
begin
  select role into user_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if user_role is not null then
    claims := jsonb_set(
      claims,
      '{app_metadata}',
      coalesce(claims -> 'app_metadata', '{}'::jsonb) || jsonb_build_object('role', user_role::text),
      true
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
