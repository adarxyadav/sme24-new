-- The invoice document bucket (spec 0011, AC-4, AC-12). Private: an invoice carries the buyer's
-- billing address and what they paid, so no object is ever publicly readable. The dashboard never
-- links an object path; it mints a short lived signed URL per request through the download route.
--
-- Policies on storage.objects scope reads to the owning organization and ops. The path is
-- `invoices/<organization_id>/<invoice id>.pdf`, so the first folder segment is the tenant and
-- `storage.foldername(name)` is what the policies compare. Only the service role writes: the
-- render task uploads, nothing else ever does.

-- The bucket row itself is created by a data migration, not here: the declarative engine refuses
-- data statements in a schema file (storage.buckets is a managed table). Only the policies, which
-- are schema, live in this file.

-- A member reads their own organization's invoices. The tenant is the first path segment, which
-- the render task writes from the invoice row, never from user input.
create policy "invoices bucket: members read their organization"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = (select private.jwt_org_id())::text
  );

create policy "invoices bucket: ops read"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'invoices' and (select private.is_ops()));

-- No insert, update or delete policy for any app role: the render task writes through the
-- service key, which bypasses RLS, and an invoice document is never replaced or deleted by a
-- user. A ten year retention rule and a delete button do not belong on the same object.
