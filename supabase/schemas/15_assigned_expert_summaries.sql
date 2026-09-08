-- What a client may see of the experts assigned to them (spec 0013, AC-12): the public half of
-- the profile, and only while an active assignment to their organization exists.
--
-- The view is `security_invoker = false`, so it runs as its owner and bypasses the table RLS that
-- would otherwise hide expert_profiles from a client. That makes the where clause the whole
-- boundary: every row this view returns is one the caller is allowed to see, checked three ways
-- (their own organization, ops, or the expert themselves). The column list is written out rather
-- than `select *`, so a column added to expert_profiles later is not client visible by accident;
-- the generated migration drops that list back to `select *` and it is re added by hand, as the
-- AGENTS.md database rule warns.
--
-- The owner is asserted in pgTAP: a future migration that recreated this view under a different
-- owner would quietly change who its definer rights belong to.

create view public.assigned_expert_summaries
with (security_invoker = false) as
select
  a.organization_id,
  a.id as assignment_id,
  a.started_at,
  p.id as expert_id,
  p.full_name,
  e.headline,
  e.bio,
  e.competencies,
  e.industries,
  e.standards,
  e.languages,
  e.photo_path
from public.expert_assignments a
join public.profiles p on p.id = a.expert_id
join public.expert_profiles e on e.expert_id = a.expert_id
where a.status = 'active'
  and e.status = 'active'
  and (
    a.organization_id = (select private.jwt_org_id())
    or (select private.is_ops())
    or a.expert_id = (select auth.uid())
  );

comment on view public.assigned_expert_summaries is 'The client visible half of an assigned expert''s profile (spec 0013). Definer view: the where clause is the access boundary.';

-- Availability, phone, years of experience and the ops notes are deliberately absent: a client
-- sees who is coming and what they cover, never when else the expert is free.

revoke all on public.assigned_expert_summaries from anon;
grant select on public.assigned_expert_summaries to authenticated;
