CREATE POLICY "invoices bucket: members read their organization" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'invoices'::text) AND ((storage.foldername(name))[1] = (( SELECT private.jwt_org_id() AS jwt_org_id))::text)));

CREATE POLICY "invoices bucket: ops read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING (((bucket_id = 'invoices'::text) AND ( SELECT private.is_ops() AS is_ops)));
