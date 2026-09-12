-- Questionnaire versions (spec 0019, AC-2; spec 0002 kind G): one row per seeded version of a
-- questionnaire (`iso45001@1`, `compliance@1`) holding its outline (sections and groups) in order.
-- Every signed in user reads; ops write through the API and `pnpm questionnaires:migration`
-- writes through a data migration. Not audited: reference data belongs to migrations and ops.
-- The newest version of a key is `order by version desc limit 1`; there is no status column, a
-- seeded version is live, and a superseded one simply stops being newest while every assessment
-- pinned to it keeps reading it (invariant 1).

create table public.questionnaire_versions (
  -- `<questionnaire key>@<version>`; text on purpose, so the seed migration is a pure function
  -- of the content file and the same row has the same key on every environment.
  key text primary key check (key ~ '^[a-z][a-z0-9_]*@[0-9]+$'),
  questionnaire_key text not null check (questionnaire_key ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version >= 1),
  title jsonb not null check (jsonb_typeof(title) = 'object' and title ? 'de' and title ? 'en'),
  -- [{key, label, title: {de, en}, groups: [{key, label, title: {de, en}}]}] in display order.
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  -- What the migration wrote, so a pgTAP count has a stated expectation.
  item_count integer not null check (item_count >= 0),
  -- Which raw file and export date the content came from.
  source_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The key spells the pair out; the check keeps the three columns honest.
  constraint questionnaire_versions_key_matches check (key = questionnaire_key || '@' || version::text),
  constraint questionnaire_versions_questionnaire_key_version_key unique (questionnaire_key, version),
  -- Redundant with the primary key on purpose: it lets `assessments` carry a composite foreign
  -- key that keeps `questionnaire_key` honest without a generated column (spec 0019).
  constraint questionnaire_versions_questionnaire_key_key_key unique (questionnaire_key, key)
);

comment on table public.questionnaire_versions is 'One row per seeded questionnaire version (spec 0019): the outline of sections and groups. Every signed in user reads; ops and migrations write.';
comment on column public.questionnaire_versions.key is '<questionnaire key>@<version>, for example iso45001@1.';
comment on column public.questionnaire_versions.sections is 'The outline in display order: [{key, label, title: {de, en}, groups: [{key, label, title: {de, en}}]}].';

alter table public.questionnaire_versions enable row level security;

create policy "questionnaire_versions: signed in users read"
  on public.questionnaire_versions
  for select
  to authenticated
  using (true);

create policy "questionnaire_versions: ops insert"
  on public.questionnaire_versions
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "questionnaire_versions: ops update"
  on public.questionnaire_versions
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger questionnaire_versions_set_updated_at
  before update on public.questionnaire_versions
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe the content every pinned
-- assessment reads; Supabase's default privileges hand it to all three app roles at creation.
-- DELETE is left to RLS, which already filters it: no policy allows one.
revoke truncate on public.questionnaire_versions from anon, authenticated, service_role;
