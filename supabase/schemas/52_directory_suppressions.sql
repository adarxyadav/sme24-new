-- Directory suppressions (spec 0018, kind G: global reference data, restricted). One row per
-- email address that must never appear in the directory again: a person who objected, a bounce,
-- or an ops decision. Holds a SHA 256 hex hash of the lowercased address, never the address, so
-- an objection outlives the row it was about without keeping the data (invariant 8).
--
-- Written by public.directory_remove_contact (in the same transaction that deletes the contact)
-- and read by the import script before every upsert. Ops read it; no other app role does.
-- No audit trigger: the removal action and the import row are the record.

create table public.directory_suppressions (
  -- encode(sha256(convert_to(lower(email), 'UTF8')), 'hex'); the script computes the same hash
  -- in Node, and a Vitest and a pgTAP case on one invented address keep the two equal.
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('data_subject_request', 'bounce', 'ops')),
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.directory_suppressions is 'SHA 256 hashes of email addresses that must never re enter the directory (spec 0018). The hash is the objection; the address itself is gone.';

alter table public.directory_suppressions enable row level security;

create policy "directory_suppressions: ops read"
  on public.directory_suppressions
  for select
  to authenticated
  using ((select private.is_ops()));

revoke insert, update, delete on public.directory_suppressions from anon, authenticated;
revoke truncate on public.directory_suppressions from anon, authenticated, service_role;
