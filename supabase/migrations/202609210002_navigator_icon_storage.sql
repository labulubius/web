-- Store imported navigator icons in a dedicated public bucket.
-- Uploads and maintenance remain restricted to site administrators.

insert into storage.buckets (id, name, public, file_size_limit)
values ('navigator-icons', 'navigator-icons', true, 1048576)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "site admins read navigator icon objects" on storage.objects;
create policy "site admins read navigator icon objects"
on storage.objects for select
to authenticated
using (bucket_id = 'navigator-icons' and public.site_is_admin());

drop policy if exists "site admins upload navigator icon objects" on storage.objects;
create policy "site admins upload navigator icon objects"
on storage.objects for insert
to authenticated
with check (bucket_id = 'navigator-icons' and public.site_is_admin());

drop policy if exists "site admins update navigator icon objects" on storage.objects;
create policy "site admins update navigator icon objects"
on storage.objects for update
to authenticated
using (bucket_id = 'navigator-icons' and public.site_is_admin())
with check (bucket_id = 'navigator-icons' and public.site_is_admin());

drop policy if exists "site admins delete navigator icon objects" on storage.objects;
create policy "site admins delete navigator icon objects"
on storage.objects for delete
to authenticated
using (bucket_id = 'navigator-icons' and public.site_is_admin());
