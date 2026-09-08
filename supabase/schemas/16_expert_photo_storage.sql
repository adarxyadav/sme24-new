-- The expert photo bucket policies (spec 0013, AC-6). Private: an expert's photo is personal data
-- of a contractor, so it is never served from a public URL. Every render mints a signed URL on the
-- server with the viewer's own client, which means these policies are the boundary for each viewer
-- rather than a decision taken once in application code.
--
-- The path is `<expert_id>/photo.<ext>`, so the first folder segment is the expert and
-- `storage.foldername(name)` is what the policies compare. The bucket row itself is created by a
-- data migration (storage.buckets is a managed table the declarative engine refuses to seed).

-- The expert owns their folder outright: read, upload, replace and remove.
create policy "expert photos: experts read their own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "expert photos: experts upload their own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "expert photos: experts replace their own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "expert photos: experts delete their own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "expert photos: ops read"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'expert-photos' and (select private.is_ops()));

-- A client member reads the photo of an expert currently assigned to their organization, and only
-- while that assignment is active. This mirrors the view's filter: the photo and the summary
-- appear and disappear together.
create policy "expert photos: assigned clients read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'expert-photos'
    and exists (
      select 1
      from public.expert_assignments a
      where a.expert_id::text = (storage.foldername(name))[1]
        and a.organization_id = (select private.jwt_org_id())
        and a.status = 'active'
    )
  );
