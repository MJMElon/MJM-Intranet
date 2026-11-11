-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- Needs 20261126100000_gw_shared_folders.sql first.
-- =====================================================================
-- 分享文件夹的权限（像 Google Drive）：gw_folder_shares.role = 'view'（只能看）| 'edit'（可以一起改心智图）
--  - 之前已经分享出去的，照旧可以改（设成 edit）；之后新分享的预设 view
--  - gw_save_folder_canvas：拥有者或 role = 'edit' 的人才能存心智图
-- 可以重复执行。
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'gw_folder_shares' and column_name = 'role'
  ) then
    alter table public.gw_folder_shares add column role text not null default 'view';
    update public.gw_folder_shares set role = 'edit';
  end if;
end $$;
alter table public.gw_folder_shares drop constraint if exists gw_folder_shares_role_check;
alter table public.gw_folder_shares add constraint gw_folder_shares_role_check check (role in ('view', 'edit'));

create or replace function public.gw_save_folder_canvas(p_folder uuid, p_canvas jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_canvas is not null and pg_column_size(p_canvas) > 300000 then
    raise exception 'gw: canvas too large' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.gw_user_folders f
    where f.id = p_folder
      and (
        f.user_id = auth.uid()
        or exists (select 1 from public.gw_folder_shares s where s.folder_id = f.id and s.user_id = auth.uid() and s.role = 'edit')
      )
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  update public.gw_user_folders set canvas = p_canvas where id = p_folder;
end $$;

select f.name as folder, p.full_name as shared_with, s.role
  from public.gw_folder_shares s
  join public.gw_user_folders f on f.id = s.folder_id
  join public.gw_profiles p on p.id = s.user_id
 order by f.name, p.full_name;
