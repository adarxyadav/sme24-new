-- pg_trgm for the contact directory's company and title search (spec 0018, AC-4). A hand written
-- migration rather than a schema file, because the declarative engine does not track extensions;
-- it is timestamped before the directory tables' diff so their GIN indexes can name
-- extensions.gin_trgm_ops. Idempotent: `if not exists`, the same shape seed.sql uses for pgcrypto.

create extension if not exists pg_trgm with schema extensions;
