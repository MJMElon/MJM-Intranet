-- =====================================================================
-- >>> RUN THIS IN THE **MJM INTRANET** DATABASE <<<
-- >>> Supabase project briqzyxfxsvulyizzbiu                          <<<
-- Supabase dashboard → (Intranet project) → SQL Editor → paste all → Run.
-- =====================================================================
-- Company billing details (Master Manage → Company 编辑窗): billing address,
-- tel, fax, e-mail. Printed on forms by the systems that sync master data
-- from here (CMMS 2 fuel claim form letterhead).
-- 可以重复执行。
-- =====================================================================

alter table public.gw_companies
  add column if not exists billing_address text check (billing_address is null or char_length(billing_address) <= 400),
  add column if not exists phone text check (phone is null or char_length(phone) <= 60),
  add column if not exists fax   text check (fax is null or char_length(fax) <= 60),
  add column if not exists email text check (email is null or char_length(email) <= 120);

select code, name, billing_address, phone, fax, email from public.gw_companies order by name;
