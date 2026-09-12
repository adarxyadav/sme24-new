-- Assessment answers (spec 0019, AC-3, AC-4; spec 0002 kind T: tenant). One row per rated item
-- of an assessment (a rating, a note, or both) or per section the expert marked not applicable
-- (item_id null, section_key set, no rating). An exclusion rides the same autosave, lock, policy
-- and audit path as a rating on purpose. An item answer with a null rating and a note is a note
-- without a rating: allowed while drafting, counted as unrated by the completeness check.
--
-- DEVIATION FROM THE TENANT TABLE CONTRACT (spec 0002), each proven by pgTAP:
--
-- 1. No client policy at all, not even a read. The client sees that an assessment is running or
--    submitted through public.assessments; the working draft, and the locked answers behind the
--    score, are the expert's (invariant 8; AC-10 proves zero rows through the API).
-- 2. The expert policies are keyed on the parent rather than on the caller's organization: an
--    expert reads the answers of assessments whose expert_id is theirs (private.owns_assessment)
--    and inserts, updates or deletes only on an assessment that is theirs, belongs to the row's
--    organization_id, is still a draft, and whose organization they are actively assigned to
--    (private.can_edit_assessment). The organization_id argument is what ties every answer row
--    to its assessment's organization (invariant 5).
-- 3. private.check_assessment_open refuses every insert, update and delete once the parent is
--    submitted, for every role including the service role, so a submitted answer set can never
--    change (AC-4). Deleting the assessment itself still cascades: the parent row is gone by the
--    time the cascade reaches this table, so a tenant deletion is not blocked.

create table public.assessment_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  -- No on delete clause: a version's items are never deleted (invariant 1), and an item with an
  -- answer must not be.
  item_id text null references public.questionnaire_items (id),
  section_key text null,
  rating text null check (rating is null or rating in ('compliant', 'partial', 'non_compliant')),
  note text null check (note is null or char_length(note) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A row is an item answer or a section exclusion, never both, never neither.
  constraint assessment_answers_item_or_section check ((item_id is null) <> (section_key is null)),
  -- An exclusion carries no rating.
  constraint assessment_answers_exclusion_has_no_rating check (item_id is not null or rating is null)
);

comment on table public.assessment_answers is 'One row per rated item or per excluded section of an assessment (spec 0019). Writable by the assessment''s expert while it is a draft; frozen for every role once submitted.';
comment on column public.assessment_answers.item_id is 'The rated item; null on a section exclusion row.';
comment on column public.assessment_answers.section_key is 'The excluded section; null on an item answer row.';

create index assessment_answers_organization_id_created_at_idx
  on public.assessment_answers (organization_id, created_at desc);
create unique index assessment_answers_assessment_id_item_id_idx
  on public.assessment_answers (assessment_id, item_id)
  where item_id is not null;
create unique index assessment_answers_assessment_id_section_key_idx
  on public.assessment_answers (assessment_id, section_key)
  where item_id is null;
create index assessment_answers_assessment_id_idx
  on public.assessment_answers (assessment_id);

-- The lock (AC-4, invariant 2). Before every insert, update and delete, the parent's status is
-- read; submitted means the row may not change, whoever asks. Definer, so the read of
-- public.assessments does not depend on the caller's policies. The service role is not exempt:
-- a task that must correct a submitted assessment has no path, which is the point. An update
-- that moves a row between assessments is checked against both parents.
create or replace function private.check_assessment_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent uuid;
begin
  foreach parent in array array_remove(array[
    case when tg_op in ('UPDATE', 'DELETE') then old.assessment_id end,
    case when tg_op in ('INSERT', 'UPDATE') then new.assessment_id end
  ], null)
  loop
    if exists (
      select 1 from public.assessments a
      where a.id = parent and a.status = 'submitted'
    ) then
      raise exception 'assessment_locked: %', parent
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function private.check_assessment_open() from public;

create trigger assessment_answers_check_open
  before insert or update or delete on public.assessment_answers
  for each row execute function private.check_assessment_open();

alter table public.assessment_answers enable row level security;

create policy "assessment_answers: experts read their own assessments"
  on public.assessment_answers
  for select
  to authenticated
  using ((select private.owns_assessment(assessment_id)));

create policy "assessment_answers: experts insert on their open draft"
  on public.assessment_answers
  for insert
  to authenticated
  with check ((select private.can_edit_assessment(assessment_id, organization_id)));

create policy "assessment_answers: experts update their open draft"
  on public.assessment_answers
  for update
  to authenticated
  using ((select private.can_edit_assessment(assessment_id, organization_id)))
  with check ((select private.can_edit_assessment(assessment_id, organization_id)));

create policy "assessment_answers: experts delete on their open draft"
  on public.assessment_answers
  for delete
  to authenticated
  using ((select private.can_edit_assessment(assessment_id, organization_id)));

create policy "assessment_answers: ops full access"
  on public.assessment_answers
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger assessment_answers_set_updated_at
  before update on public.assessment_answers
  for each row execute function public.set_updated_at();

create trigger assessment_answers_audit
  after insert or update or delete on public.assessment_answers
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS, fires no row trigger (so the lock above would not run) and would
-- wipe every rating at once; Supabase's default privileges hand it to all three app roles at
-- creation.
revoke truncate on public.assessment_answers from anon, authenticated, service_role;
