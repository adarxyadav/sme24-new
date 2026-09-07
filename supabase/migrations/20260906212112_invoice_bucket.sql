-- The private invoice bucket (spec 0011, AC-4). A data migration rather than a schema file,
-- because storage.buckets is a managed table and the declarative engine refuses data statements
-- in schemas/. The policies on storage.objects live in supabase/schemas/46_invoice_storage.sql.
--
-- Private, 10 MB per object, PDF only. An upsert, so a rerun changes nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
