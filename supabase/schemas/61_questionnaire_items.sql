-- Questionnaire items (spec 0019, AC-2; spec 0002 kind G): every clause, requirement and annex
-- line of a questionnaire version, in document order. Identity is the position within the
-- version, never the display label (invariant 6): `id` is `<version key>/<position>`, written
-- verbatim by the seed migration so the same content row has the same id on every environment.
-- A rateable item with no parent is a top level item, the unit of scoring; a rateable item with
-- a parent is an annex sub item, rated for the clause suggestion only; a non rateable item is
-- context text. Every signed in user reads; ops and migrations write. Not audited.

create table public.questionnaire_items (
  id text primary key,
  version_key text not null references public.questionnaire_versions (key) on delete cascade,
  position integer not null check (position >= 1),
  -- An annex sub item points at its clause; a parent has a smaller position (pgTAP checks it).
  parent_id text null references public.questionnaire_items (id) on delete cascade,
  section_key text not null,
  group_key text null,
  -- The display number: 4.1, 1.10, A.3.
  label text not null check (char_length(label) between 1 and 20),
  rateable boolean not null,
  title jsonb not null check (jsonb_typeof(title) = 'object' and title ? 'de' and title ? 'en'),
  requirement jsonb null check (
    requirement is null
    or (jsonb_typeof(requirement) = 'object' and requirement ? 'de' and requirement ? 'en')
  ),
  question jsonb not null check (jsonb_typeof(question) = 'object' and question ? 'de' and question ? 'en'),
  -- False while the German is the build script's draft (AC-11 shows a note on the German page).
  de_reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questionnaire_items_id_matches check (id = version_key || '/' || position::text),
  constraint questionnaire_items_version_key_position_key unique (version_key, position)
);

comment on table public.questionnaire_items is 'Every item of a questionnaire version in document order (spec 0019). Identity is the position; the label is display text. Every signed in user reads; ops and migrations write.';
comment on column public.questionnaire_items.id is '<version key>/<position>, for example iso45001@1/12.';
comment on column public.questionnaire_items.parent_id is 'The clause an annex sub item belongs to; null for a top level item.';

create index questionnaire_items_version_section_position_idx
  on public.questionnaire_items (version_key, section_key, position);
create index questionnaire_items_parent_id_idx
  on public.questionnaire_items (parent_id);

alter table public.questionnaire_items enable row level security;

create policy "questionnaire_items: signed in users read"
  on public.questionnaire_items
  for select
  to authenticated
  using (true);

create policy "questionnaire_items: ops insert"
  on public.questionnaire_items
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "questionnaire_items: ops update"
  on public.questionnaire_items
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger questionnaire_items_set_updated_at
  before update on public.questionnaire_items
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger; see 60_questionnaire_versions.sql.
revoke truncate on public.questionnaire_items from anon, authenticated, service_role;
