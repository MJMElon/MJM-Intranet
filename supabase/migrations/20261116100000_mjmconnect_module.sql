-- =====================================================================
-- MJMConnect icon on the MJM Intranet home screen
--
-- 1. Adds a new column gw_modules.auto_access:
--    true  = everyone in a Business that has this icon can see it
--            (no need to tick Access person by person)
--    false = old behaviour (Business + tick Access per person)
-- 2. Adds the MJMConnect icon (opens https://mjmconnect.opispro.com in a new tab,
--    staff log in there as usual), with auto_access = true
-- 3. Creates Business "HQ" (if not there yet) and puts MJMConnect under HQ
-- 4. Everyone already in HQ gets access now; anyone added to HQ later gets it automatically.
--    Remove someone from HQ -> the icon disappears for them.
--
-- Safe to run more than once. Paste the whole file into Supabase SQL Editor and Run.
-- =====================================================================

begin;

-- 1. auto_access column ------------------------------------------------
alter table public.gw_modules
  add column if not exists auto_access boolean not null default false;

-- 2. MJMConnect icon ---------------------------------------------------
insert into public.gw_modules
  (code, name, icon, url, image_url, description, category, access_level, open_mode, sort_order, kind, auto_access)
values (
  'MJMCONNECT',
  'MJMConnect',
  'megaphone',
  'https://mjmconnect.opispro.com/',
  'https://mjmconnect.opispro.com/icons/icon-192.png',
  'Announcements, leave, duty roster & events',
  'Office',
  1,
  'new_tab',
  20,
  'system',
  true
)
on conflict (code) do update set auto_access = true;

-- 3. Business HQ, and MJMConnect under HQ ------------------------------
insert into public.gw_groups (name)
values ('HQ')
on conflict (name) do nothing;

insert into public.gw_group_modules (group_id, module_id)
select g.id, m.id
from public.gw_groups g, public.gw_modules m
where g.name = 'HQ' and m.code = 'MJMCONNECT'
on conflict do nothing;

-- 4. Automatic access --------------------------------------------------
-- 4a. Person added to a Business -> gets every auto_access icon of that Business
create or replace function public.gw__auto_access_on_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gw_module_members (user_id, module_id)
  select new.user_id, gx.module_id
  from public.gw_group_modules gx
  join public.gw_modules m on m.id = gx.module_id and m.auto_access
  where gx.group_id = new.group_id
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists gw_auto_access_on_member on public.gw_group_members;
create trigger gw_auto_access_on_member
  after insert on public.gw_group_members
  for each row execute function public.gw__auto_access_on_member();

-- 4b. auto_access icon added to a Business -> everyone in that Business gets it
create or replace function public.gw__auto_access_on_group_module()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gw_module_members (user_id, module_id)
  select gm.user_id, new.module_id
  from public.gw_group_members gm
  join public.gw_modules m on m.id = new.module_id and m.auto_access
  where gm.group_id = new.group_id
  on conflict do nothing;
  return null;
end;
$$;

drop trigger if exists gw_auto_access_on_group_module on public.gw_group_modules;
create trigger gw_auto_access_on_group_module
  after insert on public.gw_group_modules
  for each row execute function public.gw__auto_access_on_group_module();

revoke all on function public.gw__auto_access_on_member() from public, anon, authenticated;
revoke all on function public.gw__auto_access_on_group_module() from public, anon, authenticated;

-- 4c. People already in HQ (or any Business with MJMConnect) get it now
insert into public.gw_module_members (user_id, module_id)
select gm.user_id, gx.module_id
from public.gw_group_members gm
join public.gw_group_modules gx on gx.group_id = gm.group_id
join public.gw_modules m on m.id = gx.module_id and m.auto_access
on conflict do nothing;

commit;
