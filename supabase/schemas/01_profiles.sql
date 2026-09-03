-- Profiles: one row per auth user with the app role and (from feature 3) the organization.
-- Spec 0001 security model: RLS on from the first migration, authorization claims in
-- app_metadata, the custom access token hook reads the role from here.

create type public.app_role as enum ('client', 'expert', 'ops');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'client',
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'App profile per auth user: role and organization. Feature 3 extends it.';

alter table public.profiles enable row level security;

create policy "profiles: users read their own row"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- The auth admin role (used by the access token hook) may read roles.
grant usage on schema public to supabase_auth_admin;
grant select on table public.profiles to supabase_auth_admin;

create policy "profiles: auth admin reads for the token hook"
  on public.profiles
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- Keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile when a user is created. The role comes from app_metadata (set by ops or
-- the seed), defaulting to client.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, role)
  values (
    new.id,
    case
      when requested_role in ('client', 'expert', 'ops') then requested_role::public.app_role
      else 'client'::public.app_role
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
