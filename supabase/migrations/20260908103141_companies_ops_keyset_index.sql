-- The ops companies list at /admin/companies (spec 0014, AC-1) pages across every organization on
-- the keyset (created_at, id). The existing companies_organization_id_created_at_idx is scoped to
-- one organization and cannot serve that sort, so the ops list gets the same index shape
-- email_deliveries and enquiries already carry for theirs.
--
-- Additive only: no column, constraint or policy changes, so this migration is inert to code that
-- does not use the new list and may deploy in either order with it.
--
-- Hand trimmed after `pnpm db:diff`: the generated file also re-emitted private.audit_row()
-- unchanged and rewrote the assigned_expert_summaries grant from SELECT only into full DML for
-- authenticated. Both were dropped here; the second would have handed clients write access to the
-- expert summaries view (spec 0013). This is a fourth declarative diff gotcha beyond the three
-- AGENTS.md names, and it repeats: read every generated migration before committing it.

CREATE INDEX companies_created_at_id_idx ON public.companies USING btree (created_at DESC, id DESC);
