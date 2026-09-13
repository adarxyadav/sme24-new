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

-- Any signed in user reads the photo of an `active` expert (spec 0022, AC-26). The benchmark page
-- suggests three experts to a client who has no assignment yet, and it signs each photo with the
-- caller's own client, so the photo has to be readable before an assignment exists. The status is
-- the whole gate: an invited or inactive expert's photo stays unreadable, which is what keeps a
-- deactivated contractor's picture off every page.
--
-- The status lookup goes through the definer helper rather than an inline EXISTS on
-- expert_profiles: the caller here is a client, who reads no row of that table at all, so an
-- inline subquery would answer zero rows and this policy could never match.
create policy "expert photos: signed in read an active expert's"
  on storage.objects
  for select
  to authenticated
-- The uuid cast is guarded by the shape test rather than applied straight to the folder name: a
-- cast that raises would fail the whole listing instead of hiding one object, and the expert
-- upload policies pin the folder to auth.uid() but the service role could still write any path.
  using (
    bucket_id = 'expert-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_active_expert(((storage.foldername(name))[1])::uuid))
  );

-- A client member reads the photo of an expert currently assigned to their organization, and only
-- while that assignment is active. This mirrors the view's filter: the photo and the summary
-- appear and disappear together. Kept beside the policy above: an assigned expert who has been
-- deactivated still shows their photo to the organization they are assigned to.
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
