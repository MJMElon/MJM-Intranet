-- =====================================================================
-- 一个人可以同时在同一个 Business 的好几个 Company 里
--  - gw_member_companies：每个人在每个 Business 里属于哪些 Company（一个人一个 Business 可以有多个）
--  - 原本 gw_group_members.company_id 只能记一个，现有的资料先搬过来；那一栏之后不再使用（保留，不删）
--  - 在 Business 里、但一个 Company 都没有 = 「Pending allocation to company」
--  - 权限和加人进 Business 一样：加 / 换用 can_add_business_user，移出 Company 用 can_remove_business_user（或加人的权限）
-- 只新增；gw_audit_row 多认得这张表。
-- =====================================================================

create table public.gw_member_companies (
  group_id    uuid not null,
  user_id     uuid not null,
  company_id  uuid not null,
  created_at  timestamptz not null default now(),
  primary key (group_id, user_id, company_id),
  foreign key (group_id, user_id) references public.gw_group_members (group_id, user_id) on delete cascade,
  foreign key (group_id, company_id) references public.gw_business_companies (group_id, company_id) on delete cascade
);
create index gw_member_companies_company_idx on public.gw_member_companies (company_id);
create index gw_member_companies_user_idx on public.gw_member_companies (user_id);

-- 现有的 Company 归属搬过来
insert into public.gw_member_companies (group_id, user_id, company_id)
select gm.group_id, gm.user_id, gm.company_id
from public.gw_group_members gm
where gm.company_id is not null
  and exists (select 1 from public.gw_business_companies bc where bc.group_id = gm.group_id and bc.company_id = gm.company_id)
on conflict do nothing;

alter table public.gw_member_companies enable row level security;
revoke all on public.gw_member_companies from anon;

create policy gw_member_companies_select on public.gw_member_companies
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.gw_can_view_user(user_id)));
create policy gw_member_companies_insert on public.gw_member_companies
  for insert to authenticated
  with check ((select public.gw_can_manage_group_member(group_id, user_id)));
create policy gw_member_companies_delete on public.gw_member_companies
  for delete to authenticated
  using ((select public.gw_can_manage_group_member(group_id, user_id)) or (select public.gw_can_remove_group_member(group_id, user_id)));

create or replace function public.gw_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after  jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row    jsonb := coalesce(v_after, v_before);
  v_target text := substr(tg_table_name, 4); -- 去掉 gw_ 前缀
  v_id     text;
  v_label  text;
  v_noise  constant text[] := array['locale', 'theme', 'layout_initialized', 'updated_at'];
begin
  if tg_table_name = 'gw_profiles' and tg_op = 'UPDATE'
     and (v_before - v_noise) = (v_after - v_noise) then
    return null;
  end if;

  v_id := coalesce(
    v_row ->> 'id',
    case tg_table_name
      when 'gw_group_members' then (v_row ->> 'group_id') || ':' || (v_row ->> 'user_id')
      when 'gw_group_modules' then (v_row ->> 'group_id') || ':' || (v_row ->> 'module_id')
      when 'gw_module_members' then (v_row ->> 'user_id') || ':' || (v_row ->> 'module_id')
      when 'gw_role_businesses' then (v_row ->> 'role_id') || ':' || (v_row ->> 'group_id')
      when 'gw_role_modules' then (v_row ->> 'role_id') || ':' || (v_row ->> 'group_id') || ':' || (v_row ->> 'module_id')
      when 'gw_business_companies' then (v_row ->> 'group_id') || ':' || (v_row ->> 'company_id')
      when 'gw_module_companies' then (v_row ->> 'module_id') || ':' || (v_row ->> 'company_id')
      when 'gw_member_companies' then (v_row ->> 'group_id') || ':' || (v_row ->> 'user_id') || ':' || (v_row ->> 'company_id')
    end
  );
  v_label := case tg_table_name
    when 'gw_group_members' then
      (select g.name from public.gw_groups g where g.id = (v_row ->> 'group_id')::uuid) || ' → ' ||
      (select p.email from public.gw_profiles p where p.id = (v_row ->> 'user_id')::uuid)
    when 'gw_group_modules' then
      (select g.name from public.gw_groups g where g.id = (v_row ->> 'group_id')::uuid) || ' → ' ||
      (select m.code from public.gw_modules m where m.id = (v_row ->> 'module_id')::uuid)
    when 'gw_module_members' then
      (select m.code from public.gw_modules m where m.id = (v_row ->> 'module_id')::uuid) || ' → ' ||
      (select p.email from public.gw_profiles p where p.id = (v_row ->> 'user_id')::uuid) ||
      case when (v_row ->> 'is_admin')::boolean then ' (admin)' else '' end
    when 'gw_role_businesses' then
      (select r.name from public.gw_roles r where r.id = (v_row ->> 'role_id')::uuid) || ' → ' ||
      (select g.name from public.gw_groups g where g.id = (v_row ->> 'group_id')::uuid)
    when 'gw_role_modules' then
      (select r.name from public.gw_roles r where r.id = (v_row ->> 'role_id')::uuid) || ' → ' ||
      (select m.code from public.gw_modules m where m.id = (v_row ->> 'module_id')::uuid)
    when 'gw_business_companies' then
      (select g.name from public.gw_groups g where g.id = (v_row ->> 'group_id')::uuid) || ' → ' ||
      (select c.name from public.gw_companies c where c.id = (v_row ->> 'company_id')::uuid)
    when 'gw_module_companies' then
      (select m.code from public.gw_modules m where m.id = (v_row ->> 'module_id')::uuid) || ' → ' ||
      (select c.name from public.gw_companies c where c.id = (v_row ->> 'company_id')::uuid)
    when 'gw_member_companies' then
      (select p.email from public.gw_profiles p where p.id = (v_row ->> 'user_id')::uuid) || ' → ' ||
      (select g.name from public.gw_groups g where g.id = (v_row ->> 'group_id')::uuid) || ' · ' ||
      (select c.name from public.gw_companies c where c.id = (v_row ->> 'company_id')::uuid)
    when 'gw_company_mappings' then
      (select c.name from public.gw_companies c where c.id = (v_row ->> 'company_id')::uuid) || ' → ' ||
      (select m.code from public.gw_modules m where m.id = (v_row ->> 'module_id')::uuid) || ' ' || (v_row ->> 'external_id')
    else coalesce(v_row ->> 'code', v_row ->> 'email', v_row ->> 'name', left(v_row ->> 'message', 60))
  end;

  perform public.gw__write_audit(auth.uid(), lower(tg_op), v_target, v_id, v_label, v_before, v_after);
  return null;
end;
$$;

create trigger gw_audit after insert or update or delete on public.gw_member_companies
  for each row execute function public.gw_audit_row();
