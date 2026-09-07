-- The private expert photo bucket (spec 0012, AC-6). A data migration rather than a schema file,
-- because storage.buckets is a managed table and the declarative engine refuses data statements
-- in schemas/. The policies on storage.objects live in supabase/schemas/16_expert_photo_storage.sql.
--
-- Private, 2 MB per object, the three image types the upload action accepts. An upsert, so a
-- rerun changes nothing.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expert-photos',
  'expert-photos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
