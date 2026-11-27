-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (briqzyxfxsvulyizzbiu) <<<
-- Table descriptions, by category (shown in Supabase → Table Editor), and
-- one table nothing uses any more. Safe to run more than once.
--
--   gw_ = "Gateway", the Intranet's first name. "group" in a table name = Business.
--
--   1 People & sign-in      gw_profiles, gw_roles, gw_role_businesses, gw_login_attempts,
--                           gw_token_redemptions, gw_mcp_tokens
--   2 Business & company    gw_groups, gw_sectors, gw_companies, gw_company_locations,
--                           gw_business_companies
--   3 Who is in a business  gw_group_members, gw_member_companies
--   4 Modules & access      gw_modules, gw_group_modules, gw_module_companies, gw_module_members,
--                           gw_module_api_keys, gw_module_opens, gw_user_module_seen
--   5 Home page (per person) gw_user_widgets, gw_user_sections, gw_user_section_items,
--                           gw_user_layout, gw_user_links, gw_user_folders
--   6 Folders & sheets      gw_folder_shares, gw_folder_business_shares, gw_folder_transfers,
--                           gw_folder_cell_comments
--   7 Notices               gw_announcements, gw_notice_reactions
--   8 System                gw_settings, gw_audit_logs, gw_migrations, gw_ai_usage
-- =====================================================================

do $$
declare
  d record;
begin
  for d in select * from (values
    ('gw_profiles',              '1 People · Each person who can sign in to the Intranet (name, email, role, status)'),
    ('gw_roles',                 '1 People · Roles (Super Admin / custom roles) and what each may manage'),
    ('gw_role_businesses',       '1 People · Which Businesses a role may manage'),
    ('gw_login_attempts',        '1 People · Wrong-password count per email (no lock-out any more)'),
    ('gw_token_redemptions',     '1 People · Sign-in tokens already used to open a module (each works once)'),
    ('gw_mcp_tokens',            '1 People · Personal keys for connecting an AI assistant (MCP) to the Intranet'),
    ('gw_groups',                '2 Business · The Businesses (Plantation, Palm Oil Mill, HQ…). "group" = Business'),
    ('gw_sectors',               '2 Business · Sectors that Businesses are grouped under'),
    ('gw_companies',             '2 Business · Company master list (code, name, short name, Opispro location ID)'),
    ('gw_company_locations',     '2 Business · Locations of a company with multiple locations (name, short name, location ID, area)'),
    ('gw_business_companies',    '2 Business · Which companies belong to which Business'),
    ('gw_group_members',         '3 Members · Which people are in which Business'),
    ('gw_member_companies',      '3 Members · Which companies of that Business each person has'),
    ('gw_modules',               '4 Modules · The systems / icons (Plantation Operation, Management Report, Mantap…), address and sign-in type'),
    ('gw_group_modules',         '4 Modules · Which modules each Business has'),
    ('gw_module_companies',      '4 Modules · Module limited to certain companies (none = all companies of the Business)'),
    ('gw_module_members',        '4 Modules · People given a module (per company), and module leads'),
    ('gw_module_api_keys',       '4 Modules · API key of each module (its system uses it to check access); only a hash is kept'),
    ('gw_module_opens',          '4 Modules · When each person opened a module (for "Recent")'),
    ('gw_user_module_seen',      '4 Modules · Modules a person has already seen (removes the NEW badge)'),
    ('gw_user_widgets',          '5 Home page · Widgets on a person''s home page (clock, notices, notes…) and the page layout'),
    ('gw_user_sections',         '5 Home page · Business box open or closed, per person'),
    ('gw_user_section_items',    '5 Home page · Icons, folders and notes inside each Business box, per person'),
    ('gw_user_layout',           '5 Home page · Module icons in My Home and in personal folders, per person'),
    ('gw_user_links',            '5 Home page · Personal links (own icons to any web address)'),
    ('gw_user_folders',          '5 Home page · Personal folders (also the sheets / canvas inside them)'),
    ('gw_folder_shares',         '6 Folders · Folder shared with a person (view / edit)'),
    ('gw_folder_business_shares','6 Folders · Folder shared with a whole Business (or one of its companies)'),
    ('gw_folder_transfers',      '6 Folders · Requests to hand a folder over to another owner'),
    ('gw_folder_cell_comments',  '6 Folders · Comments on cells of a sheet in a folder'),
    ('gw_announcements',         '7 Notices · Notice board posts'),
    ('gw_notice_reactions',      '7 Notices · Reactions on notice board posts'),
    ('gw_settings',              '8 System · Intranet-wide settings (key → value)'),
    ('gw_audit_logs',            '8 System · Who changed what (Admin → Audit log)'),
    ('gw_migrations',            '8 System · Which database updates have been run (docs/check-database.sql)'),
    ('gw_ai_usage',              '8 System · AI assistant questions per person per day (daily limit)')
  ) as t(tbl, txt)
  loop
    if to_regclass('public.' || d.tbl) is not null then
      execute format('comment on table public.%I is %L', d.tbl, d.txt);
    end if;
  end loop;
end $$;

-- Not used any more: "company code in another system", per module. Nothing reads or
-- edits it (Location IDs / Opispro IDs replaced it). Removed only when it is empty;
-- if it still has rows they are kept: check them with  select * from public.gw_company_mappings;
do $$
begin
  if to_regclass('public.gw_company_mappings') is not null
     and not exists (select 1 from public.gw_company_mappings) then
    drop table public.gw_company_mappings;
  end if;
end $$;

insert into public.gw_migrations (name) values ('20261214100000_gw_table_descriptions') on conflict (name) do nothing;
notify pgrst, 'reload schema';

-- Check: the table list with its category, and whether gw_company_mappings is gone
select c.relname as table_name, obj_description(c.oid) as description
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'gw\_%'
 order by obj_description(c.oid) nulls first, c.relname;
