SET local check_function_bodies = off;

ALTER TABLE "public"."orders"
  DROP CONSTRAINT "orders_status_check";

ALTER TABLE "public"."orders"
  ADD COLUMN "scheduled_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "assigned_expert_id" uuid;

ALTER TABLE "public"."orders"
  ADD COLUMN "delivered_at" timestamp WITH time zone;

ALTER TABLE "public"."orders"
  ADD COLUMN "scheduled_by" uuid;

CREATE OR REPLACE FUNCTION private.check_order_delivery_columns()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if old.status is distinct from new.status then
    return new;
  end if;
  if new.status not in ('scheduled', 'in_progress', 'delivered') then
    raise exception 'orders delivery columns require a scheduled, in_progress or delivered order, not %', new.status
      using errcode = 'check_violation';
  end if;
  if new.scheduled_at is null or new.assigned_expert_id is null then
    raise exception 'orders % requires scheduled_at and assigned_expert_id', new.status
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_order_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if old.status = new.status then
    raise exception 'orders status is already %', old.status
      using errcode = 'check_violation';
  end if;

  -- Payment edges (spec 0011).
  if (old.status = 'pending' and new.status in ('paid', 'cancelled', 'expired'))
     or (old.status = 'paid' and new.status = 'refunded')
     or (old.status = 'delivered' and new.status = 'refunded') then
    return new;
  end if;

  -- Delivery edges (spec 0014). Each one carries the invariant its target state implies, so
  -- neither a scheduled order without a date nor a delivered one without a delivered_at exists.
  if old.status = 'paid' and new.status = 'scheduled' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders scheduled requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'orders scheduled_at must be in the future'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'scheduled' and new.status = 'in_progress' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders in_progress requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Unschedule. Both columns must be cleared in the same statement, so paid never carries a date.
  if old.status = 'scheduled' and new.status = 'paid' then
    if new.scheduled_at is not null or new.assigned_expert_id is not null then
      raise exception 'orders unschedule requires scheduled_at and assigned_expert_id to be null'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'in_progress' and new.status = 'delivered' then
    if new.scheduled_at is null or new.assigned_expert_id is null then
      raise exception 'orders delivered requires scheduled_at and assigned_expert_id'
        using errcode = 'check_violation';
    end if;
    if new.delivered_at is null then
      raise exception 'orders delivered requires delivered_at'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  raise exception 'invalid orders transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$function$;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_assigned_expert_id_fkey" FOREIGN KEY (assigned_expert_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_scheduled_by_fkey" FOREIGN KEY (scheduled_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_status_check"
    CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text, 'expired'::text, 'scheduled'::text, 'in_progress'::text, 'delivered'::text])));

CREATE INDEX orders_assigned_expert_id_idx ON public.orders USING btree (assigned_expert_id);

CREATE INDEX orders_paid_unscheduled_idx ON public.orders USING btree (paid_at)
  WHERE (status = 'paid'::text);

CREATE INDEX orders_scheduled_at_idx ON public.orders USING btree (scheduled_at)
  WHERE (status = ANY (ARRAY['scheduled'::text, 'in_progress'::text]));

CREATE TRIGGER orders_check_delivery_columns
  BEFORE UPDATE OF scheduled_at, assigned_expert_id ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.check_order_delivery_columns();

COMMENT ON COLUMN "public"."orders"."assigned_expert_id" IS 'The assessor doing the work. Set together with scheduled_at; the ops action also upserts the matching active expert_assignments row, which is what actually grants the expert access.';

COMMENT ON COLUMN "public"."orders"."delivered_at" IS 'When the assessment was delivered. Required by the in_progress -> delivered edge.';

COMMENT ON COLUMN "public"."orders"."scheduled_at" IS 'The agreed on site date and time. Not null exactly while the status is scheduled, in_progress or delivered; the future date check binds only on the paid -> scheduled edge, so a visit may be recorded after the fact.';

COMMENT ON COLUMN "public"."orders"."scheduled_by" IS 'The ops actor who scheduled the order, from auth.getClaims() in the action.';

REVOKE ALL ON FUNCTION "private"."check_order_delivery_columns"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."check_order_delivery_columns"() TO "postgres";

-- Re-added by hand (AGENTS.md): the declarative diff emits only the PUBLIC revoke on a new
-- function, so the app roles keep the execute Supabase's default privileges granted them.
REVOKE EXECUTE ON FUNCTION "private"."check_order_delivery_columns"() FROM anon, authenticated;

-- Invariant 3 (spec 0014): UPDATE on orders stays revoked from the app roles with no column
-- granted back, so the four new delivery columns are writable only by the service client behind
-- an ops check. Re-asserted here because ADD COLUMN is where a column grant would leak back in.
REVOKE UPDATE ON TABLE "public"."orders" FROM anon, authenticated;
