SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.directory_size()
  RETURNS TABLE (
    companies bigint,
    contacts  bigint
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if not (private.is_ops() or private.is_active_expert()) then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    select
      (select count(*) from public.directory_companies),
      (select count(*) from public.directory_contacts);
end;
$function$;

COMMENT ON FUNCTION "public"."directory_size"() IS 'The company and contact counts of the directory (spec 0018, AC-5), for the figures above the search form. Active experts and ops only.';

-- By hand, per AGENTS.md: the diff never emits the `anon` execute revoke on a new public
-- function, so this repeats it.
REVOKE EXECUTE ON FUNCTION "public"."directory_size"() FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."directory_size"() TO "authenticated", "postgres", "service_role";

-- The diff also re-emitted a widened grant (SELECT to full DML for `authenticated`) on
-- `assigned_expert_summaries` and `expert_bookings`, the fourth hand fix AGENTS.md lists. Both
-- are unrelated to this change and both must stay read only, so those four statements are
-- dropped rather than committed.
