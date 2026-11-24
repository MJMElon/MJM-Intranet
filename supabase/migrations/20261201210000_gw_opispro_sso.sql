-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE (project briqzyxfxsvulyizzbiu) <<<
-- Sign in with OPIS PRO：每个 Intranet 用户可以连结一个 OPIS PRO 帐号
--  - gw_profiles.opispro_user_id = OPIS PRO 的 user ID（ID token 的 sub）
--  - 第一次用 OPIS PRO 登入时用 email 找到人并记下；以后只认这个 ID
--  - 只有 Super Admin（或伺服器）可以改；一个 OPIS PRO 帐号只能连一个 Intranet 用户
-- 可以重复执行。
-- =====================================================================
alter table public.gw_profiles add column if not exists opispro_user_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gw_profiles_opispro_user_id_check') then
    alter table public.gw_profiles
      add constraint gw_profiles_opispro_user_id_check check (opispro_user_id is null or opispro_user_id ~ '^[0-9]{1,20}$');
  end if;
end $$;
create unique index if not exists gw_profiles_opispro_user_id_key on public.gw_profiles (opispro_user_id) where opispro_user_id is not null;
