-- Realtime rules (spec 0001): each table that emits changes joins the publication explicitly.
-- Realtime evaluates the subscriber's SELECT policies per change. Numbered 90 so it stays last.
alter publication supabase_realtime add table public.scaffold_checks;
alter publication supabase_realtime add table public.research_runs;
alter publication supabase_realtime add table public.email_deliveries;
