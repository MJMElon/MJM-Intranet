-- Icon look (icon, colour, picture) that people can change from the main page.
--  - Module: super admin, or the lead of that module in any Business (gw_group_modules.lead_user_id).
--  - Folder: its owner (stored in gw_user_folders.look, which only the owner can update).
-- Safe to run more than once.

alter table public.gw_modules add column if not exists color text;
alter table public.gw_modules drop constraint if exists gw_modules_color_check;
alter table public.gw_modules add constraint gw_modules_color_check check (color is null or char_length(color) <= 20);

alter table public.gw_user_folders add column if not exists look jsonb;

-- Modules I lead (in any Business)
create or replace function public.gw_my_lead_modules()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct gm.module_id from public.gw_group_modules gm where gm.lead_user_id = (select auth.uid());
$$;

-- Change a module's look (icon, colour, picture)
create or replace function public.gw_set_module_look(p_module uuid, p_icon text, p_color text, p_image_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.gw_is_super_admin()
    or exists (select 1 from public.gw_group_modules gm where gm.module_id = p_module and gm.lead_user_id = (select auth.uid()))
  ) then
    raise exception 'gw: not allowed' using errcode = '42501';
  end if;
  update public.gw_modules
     set icon = coalesce(nullif(btrim(coalesce(p_icon, '')), ''), icon),
         color = nullif(btrim(coalesce(p_color, '')), ''),
         image_url = nullif(btrim(coalesce(p_image_url, '')), '')
   where id = p_module;
end;
$$;

revoke execute on function public.gw_my_lead_modules(), public.gw_set_module_look(uuid, text, text, text) from public, anon;
grant execute on function public.gw_my_lead_modules(), public.gw_set_module_look(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
