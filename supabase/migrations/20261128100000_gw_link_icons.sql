-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- 个人连结图示（Add Icon）：可以选颜色、上传自己的照片
--  - gw_user_links.color：图示底色（主页调色盘的名字，例如 blue / rose；空 = 自动）
--  - storage bucket link-icons：每个人只能放在自己的资料夹（<user id>/...）里；公开读
-- 可以重复执行。
-- =====================================================================

alter table public.gw_user_links add column if not exists color text check (char_length(color) <= 20);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('link-icons', 'link-icons', true, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "link icons write" on storage.objects;
create policy "link icons write" on storage.objects
  for all to authenticated
  using (bucket_id = 'link-icons' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'link-icons' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "link icons read" on storage.objects;
create policy "link icons read" on storage.objects
  for select to authenticated
  using (bucket_id = 'link-icons');

select count(*) as links_with_photo from public.gw_user_links where image_url is not null;
