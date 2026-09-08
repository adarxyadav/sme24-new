-- Ops notes on an expert (spec 0013, kind I): the record check trail, kept apart from
-- expert_profiles precisely so no policy mistake on that table can ever show an expert what ops
-- wrote about them. One policy, ops only, for every command; the expert pages never query it.

create table public.expert_ops_notes (
  expert_id uuid primary key references public.profiles (id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 4000),
  updated_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.expert_ops_notes is 'Ops only notes about an expert (spec 0013). Never readable by the expert.';

create index expert_ops_notes_updated_by_idx on public.expert_ops_notes (updated_by);

alter table public.expert_ops_notes enable row level security;

create policy "expert_ops_notes: ops full access"
  on public.expert_ops_notes
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger expert_ops_notes_set_updated_at
  before update on public.expert_ops_notes
  for each row execute function public.set_updated_at();

create trigger expert_ops_notes_audit
  after insert or update or delete on public.expert_ops_notes
  for each row execute function private.audit_row();

-- Ops only means ops only: anon holds nothing, and the authenticated grant is what the ops policy
-- rides on. Supabase grants anon the full set at table creation, so it is revoked by hand here and
-- re added by hand in the migration (the diff replays the default).
revoke all on public.expert_ops_notes from anon;

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.expert_ops_notes from anon, authenticated, service_role;
