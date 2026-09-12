-- record of processing: the table list in docs/legal/record-of-processing.md is exactly the set of
-- tables that actually exist in the public schema (spec 0015, AC-16).
--
-- This is pgTAP rather than Vitest because the check reads `information_schema` and so needs the
-- live stack, unlike the catalogue equality tests that compare two in-repo constants. The
-- documented list is embedded below rather than read from the markdown, because `supabase test db`
-- runs SQL with no filesystem access; a Vitest test (tests/features/legal/record-of-processing.test.ts)
-- keeps this list equal to the document's table column, so the chain document -> here -> schema
-- has no gap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- The tables docs/legal/record-of-processing.md documents, one row per table in its main table.
create function pg_temp.documented_tables()
returns table (name text) language sql as $$
  values
    ('audit_log'),
    ('benchmark_assumptions'),
    ('benchmark_snapshots'),
    ('benchmarks'),
    ('companies'),
    ('company_kpis'),
    ('data_requests'),
    ('directory_companies'),
    ('directory_contacts'),
    ('directory_credit_entries'),
    ('directory_imports'),
    ('directory_suppressions'),
    ('directory_unlocks'),
    ('email_deliveries'),
    ('enquiries'),
    ('expert_assignments'),
    ('expert_ops_notes'),
    ('expert_profiles'),
    ('invoices'),
    ('kpi_definitions'),
    ('notifications'),
    ('order_events'),
    ('orders'),
    ('organization_members'),
    ('organizations'),
    ('packages'),
    ('profiles'),
    ('questionnaire_items'),
    ('questionnaire_versions'),
    ('research_runs'),
    ('scaffold_checks'),
    ('stripe_events')
$$;

-- Base tables only: a view is a way of reading a table already listed, not a new place data lives.
create function pg_temp.actual_tables()
returns table (name text) language sql as $$
  select table_name::text
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
$$;

select is_empty(
  $$ select name from pg_temp.actual_tables()
     except select name from pg_temp.documented_tables() $$,
  'every table in the public schema appears in the record of processing');

select is_empty(
  $$ select name from pg_temp.documented_tables()
     except select name from pg_temp.actual_tables() $$,
  'every table the record of processing names still exists');

-- A guard on the guard: an empty documented list would pass the first assertion trivially.
select cmp_ok(
  (select count(*)::int from pg_temp.documented_tables()), '>=', 20,
  'the record of processing documents the whole schema, not a handful of tables');

select * from finish();
rollback;
