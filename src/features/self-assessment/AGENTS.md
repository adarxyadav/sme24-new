# src/features/self-assessment

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Client entered KPIs

The "Your figures" card in `src/features/self-assessment/` writes the same `company_kpis` table as research with `source 'client'`: `saveClientKpis` reads then writes (the client unique index is partial, so PostgREST cannot upsert onto it) and `clearClientKpi` deletes one row so the research value shows again; both queue `benchmark-company` with `triggerKind 'client_edit'` under `benchmark/kpis/<companyId>/<moment>` and `benchmark/kpis-clear/<rowId>`, and both answer a typed result, never throw. Every hand entered value belongs to one reporting year from the pure rules in `years.ts` (`currentYear` reads the server clock in `Europe/Zurich`); the form parses with the `clientKpisFormSchema(currentYear)` factory and sends only the fields the client changed, so an untouched research value is never copied into a client row. Strings live in the `selfAssessment` namespace in both catalogs. The update and delete policies are per creator until feature 22 relaxes them to organization scope.
