-- Assessments (spec 0019, AC-3, AC-4; spec 0002 kind T: tenant). One row per questionnaire an
-- expert runs for a client company: pinned to one questionnaire version for life, drafted by the
-- expert who started it, and submitted exactly once. There is no score column: the score is
-- computed at read time from the pinned version and the answers, so it can never go stale and the
-- gap report (feature 18) computes the same number.
--
-- DEVIATION FROM THE TENANT TABLE CONTRACT (spec 0002), each proven by pgTAP:
--
-- 1. No client write policy at all. A client member reads the rows of their organization (the
--    state of a booked assessment) and never inserts, updates or deletes one: the assessment is
--    the expert's work product, and a half finished draft is not the client's to touch.
-- 2. Experts get an insert and an update policy here, because this is the feature that names
--    them: an expert starts a draft only for an organization they are actively assigned to, with
--    themselves as expert_id, a company of that organization and an order that is null or one of
--    their own bookings (checked through the expert_bookings view below), and updates only their
--    own draft while the assignment is still active.
-- 3. A second expert read policy, "experts read their own rows", so an expert whose assignment
--    ended still reads what they submitted (the assigned experts read policy alone would hide it).
-- 4. UPDATE is revoked from authenticated and granted back on three columns only (status, site,
--    conducted_on), so neither an expert nor ops can move a draft to another organization,
--    company, expert or version through the API; an ops write beyond the three columns goes
--    through the service client (the spec 0014 pattern). The declarative diff drops this column
--    grant after the table level REVOKE, so the migration re adds it by hand (AGENTS.md).
--
-- The state machine (draft -> submitted, once, only when complete) is the
-- private.check_assessment_transition trigger below; the lock on the answers of a submitted
-- assessment is private.check_assessment_open in 63_assessment_answers.sql.

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Restrict, so a company with an assessment cannot vanish under it.
  company_id uuid not null references public.companies (id) on delete restrict,
  -- The booking this assessment delivers, when there is one; set null so a deleted order never
  -- takes the expert's findings with it.
  order_id uuid null references public.orders (id) on delete set null,
  questionnaire_key text not null,
  -- The pinned version (`iso45001@1`); never updated (invariant 1), which the column grant
  -- below enforces for every app role.
  questionnaire_version_key text not null,
  -- Restrict, because a profile is anonymised, never deleted, and the finding keeps its author.
  expert_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  site text null check (site is null or char_length(site) between 1 and 200),
  conducted_on date null,
  -- Set by the transition trigger on the draft -> submitted edge, never by a caller.
  submitted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessments_submitted_at_matches_status
    check ((status = 'submitted') = (submitted_at is not null)),
  -- The composite key keeps questionnaire_key honest against the pinned version without a
  -- generated column: (questionnaire_key, key) is unique on questionnaire_versions on purpose.
  constraint assessments_questionnaire_version_fkey
    foreign key (questionnaire_key, questionnaire_version_key)
    references public.questionnaire_versions (questionnaire_key, key)
);

comment on table public.assessments is 'One questionnaire run by an expert for a client company (spec 0019): pinned to a version, drafted, submitted once. No score column: the score is computed from the answers.';
comment on column public.assessments.questionnaire_version_key is 'The questionnaire_versions row this assessment is rated against, pinned for life.';
comment on column public.assessments.order_id is 'The booking this assessment delivers, or null when it was started without one.';
comment on column public.assessments.submitted_at is 'Written by private.check_assessment_transition on the draft -> submitted edge; never by a caller.';

create index assessments_organization_id_created_at_idx
  on public.assessments (organization_id, created_at desc);
-- The restrict foreign key is checked on every company delete; the expert's home lists by
-- expert and status.
create index assessments_company_id_idx on public.assessments (company_id);
create index assessments_expert_id_status_idx on public.assessments (expert_id, status);
-- The client card and the ops orders table join the state per order; most rows have one.
create index assessments_order_id_idx on public.assessments (order_id) where order_id is not null;
-- One open draft per company and questionnaire (invariant 3, the research_runs shape); the
-- action maps the violation to draft_exists (AC-5).
create unique index assessments_one_draft_per_company_questionnaire_idx
  on public.assessments (company_id, questionnaire_key)
  where status = 'draft';

-- What an expert may know about an order (spec 0019): that an assessment is booked, when, for
-- which company and which package. A deliberate narrowing of the spec 0011 rule that experts do
-- not read orders, enforced here by the column list: no money column, no billing address, no
-- Stripe id. Definer (`security_invoker = false`) like assigned_expert_summaries, because the
-- expert has no select policy on orders at all, so the where clause is the whole boundary: the
-- caller's own bookings, or everything for ops. The owner is asserted in pgTAP. The generated
-- migration rewrites the column list to `select *` and widens the grant to full DML; both are
-- fixed by hand (AGENTS.md).
create view public.expert_bookings
with (security_invoker = false) as
select
  o.id,
  o.organization_id,
  o.company_id,
  o.reference,
  o.package_key,
  o.package_name_snapshot,
  o.status,
  o.scheduled_at,
  o.delivered_at
from public.orders o
where o.status in ('scheduled', 'in_progress', 'delivered')
  and (
    o.assigned_expert_id = (select auth.uid())
    or (select private.is_ops())
  );

comment on view public.expert_bookings is 'The bookings an expert is the assessor of (spec 0019): what, when and for whom, never the money. Definer view: the where clause is the access boundary.';

revoke all on public.expert_bookings from anon;
grant select on public.expert_bookings to authenticated;

-- True when the caller is the expert of the assessment. Definer, so the select policy on
-- assessment_answers reads assessments without going through its policies (the is_org_owner
-- reasoning from spec 0002); the auth.uid() check keeps it safe.
create or replace function private.owns_assessment(assessment_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or assessment_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.assessments a
    where a.id = owns_assessment.assessment_id
      and a.expert_id = caller
  );
end;
$$;

-- True when the caller may still write the answers of the assessment: it is theirs, it belongs
-- to `org` (which ties every answer row to its assessment's organization, invariant 5), it is
-- still a draft, and their assignment to that organization is active. Definer for the same
-- reason as owns_assessment.
create or replace function private.can_edit_assessment(assessment_id uuid, org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or assessment_id is null or org is null then
    return false;
  end if;
  return exists (
    select 1
    from public.assessments a
    where a.id = can_edit_assessment.assessment_id
      and a.organization_id = org
      and a.expert_id = caller
      and a.status = 'draft'
  )
  and private.is_assigned_expert(org);
end;
$$;

revoke execute on function private.owns_assessment(uuid) from public;
revoke execute on function private.can_edit_assessment(uuid, uuid) from public;
grant execute on function private.owns_assessment(uuid) to authenticated, service_role;
grant execute on function private.can_edit_assessment(uuid, uuid) to authenticated, service_role;

-- The state machine (AC-4, invariant 2). Fires only when an update names the status column, so
-- site and conducted_on stay editable on a draft. draft -> submitted passes only when every
-- rateable top level item of a section that is not excluded carries a rating, and then stamps
-- submitted_at; every other change of status raises. Naming the same status again is not a
-- change and passes untouched. Definer, so the completeness count reads questionnaire_items and
-- assessment_answers without the caller's policies: the number is the same whoever submits.
-- Both messages use errcode check_violation; classifyAssessmentError matches the fragments.
create or replace function private.check_assessment_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  unrated integer;
begin
  if old.status = new.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'submitted' then
    -- Rateable top level items of the pinned version (sub items never count, invariant 4) whose
    -- section is not excluded and that have no answer row with a rating. A note without a rating
    -- counts as unrated.
    select count(*)
    into unrated
    from public.questionnaire_items i
    where i.version_key = new.questionnaire_version_key
      and i.rateable
      and i.parent_id is null
      and not exists (
        select 1 from public.assessment_answers x
        where x.assessment_id = new.id
          and x.item_id is null
          and x.section_key = i.section_key
      )
      and not exists (
        select 1 from public.assessment_answers r
        where r.assessment_id = new.id
          and r.item_id = i.id
          and r.rating is not null
      );
    if unrated > 0 then
      raise exception 'assessment_incomplete: % items unrated', unrated
        using errcode = 'check_violation';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());
    return new;
  end if;

  raise exception 'invalid assessments transition % -> % on %', old.status, new.status, old.id
    using errcode = 'check_violation';
end;
$$;

revoke execute on function private.check_assessment_transition() from public;

create trigger assessments_check_transition
  before update of status on public.assessments
  for each row execute function private.check_assessment_transition();

alter table public.assessments enable row level security;

create policy "assessments: members read their organization"
  on public.assessments
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

create policy "assessments: assigned experts read"
  on public.assessments
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "assessments: experts read their own rows"
  on public.assessments
  for select
  to authenticated
  using (expert_id = (select auth.uid()));

-- An expert starts a draft: an organization they are actively assigned to, themselves as the
-- expert, status draft, a company of that organization (the subquery runs under the assigned
-- experts read policy on companies) and an order that is null or one of their own bookings for
-- that organization (the subquery runs through the definer view, which is the only read an
-- expert has of orders). The version is not checked here: the composite foreign key is what
-- keeps questionnaire_key and questionnaire_version_key honest.
create policy "assessments: experts start a draft for an assigned organization"
  on public.assessments
  for insert
  to authenticated
  with check (
    (select private.is_assigned_expert(organization_id))
    and expert_id = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.organization_id = assessments.organization_id
    )
    and (
      order_id is null
      or exists (
        select 1 from public.expert_bookings b
        where b.id = order_id and b.organization_id = assessments.organization_id
      )
    )
  );

-- An expert updates their own draft while their assignment is active; the with check lets the
-- row become submitted, and the column grant below limits the update to status, site and
-- conducted_on. A submitted row is never in the using clause, so the expert cannot touch it.
create policy "assessments: experts update their own draft"
  on public.assessments
  for update
  to authenticated
  using (
    expert_id = (select auth.uid())
    and status = 'draft'
    and (select private.is_assigned_expert(organization_id))
  )
  with check (
    expert_id = (select auth.uid())
    and (select private.is_assigned_expert(organization_id))
  );

create policy "assessments: ops full access"
  on public.assessments
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger assessments_set_updated_at
  before update on public.assessments
  for each row execute function public.set_updated_at();

create trigger assessments_audit
  after insert or update or delete on public.assessments
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every expert's findings
-- at once with nothing in the audit log; Supabase's default privileges hand it to all three app
-- roles at creation. DELETE is left to RLS: only the ops policy allows one.
revoke truncate on public.assessments from anon, authenticated, service_role;

-- Deviation 4: the table level UPDATE is revoked from authenticated and granted back per column,
-- so no app role can move an assessment to another organization, company, expert or version, or
-- write submitted_at directly. Ops share the grant, which is why an ops write beyond these three
-- columns goes through the service client. The declarative diff drops column grants after a
-- table level REVOKE, so the migration re adds this grant by hand (AGENTS.md).
revoke update on public.assessments from authenticated;
grant update (status, site, conducted_on) on public.assessments to authenticated;
