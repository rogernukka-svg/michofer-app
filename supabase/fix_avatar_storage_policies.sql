insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_upload_own" on storage.objects;
drop policy if exists "avatars_read_public" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_upload_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_update_own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  )
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );
