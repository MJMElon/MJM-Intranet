// 给接入的系统（例如 CMMS 2）同步主资料：Business、Company、两者的连结，
// 以及哪些 Company 标签了这个 Icon。
// Header：x-gw-api-key（这个 Icon 的 API Key，和 gw-check-access 一样）
// 请求：POST {}      回应：{ module_code, module_users, businesses, companies, links, locations, estates, module_company_ids, module_business_ids, exported_at }
// module_users = 目前可以用这个 Icon 的人（id、email、full_name、is_admin、company_ids），接入系统用来预先建立帐号 / 显示名单
// company_ids = 这个人在这个 Icon 可以看的 Company：他有这个 Icon 的 Business 里，HR 分配给他的 Company
//               （在 Business 里但还没分 Company = 空的 = 看不到任何 Company）；super_admin = 有这个 Icon 的全部 Company
// 只读；资料库一律用 service_role 读取（API Key 已经证明来源）。
import { corsHeaders, json, serviceClient, sha256Hex } from "../_shared/gw.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = req.headers.get("x-gw-api-key");
  if (!apiKey) return json({ error: "api_key_required" }, 401);

  const supabase = serviceClient();
  const { data: keyRow } = await supabase
    .from("gw_module_api_keys")
    .select("module_id, gw_modules!inner(id, code)")
    .eq("key_hash", await sha256Hex(apiKey))
    .maybeSingle();
  if (!keyRow) return json({ error: "invalid_api_key" }, 401);
  const module = keyRow.gw_modules as unknown as { id: string; code: string };

  const [businesses, companies0, links, tagged, taggedBiz, members, groupMembers, profiles, locations, memberCompanies] = await Promise.all([
    supabase.from("gw_groups").select("id, name, description, sort_order").order("sort_order").order("name"),
    supabase
      .from("gw_companies")
      .select("id, code, name, short_name, registration_no, description, is_active, sort_order, opispro_id, has_locations, billing_address, phone, fax, email")
      .order("sort_order")
      .order("name"),
    supabase.from("gw_business_companies").select("group_id, company_id"),
    supabase.from("gw_module_companies").select("company_id").eq("module_id", module.id),
    supabase.from("gw_group_modules").select("group_id").eq("module_id", module.id),
    supabase.from("gw_module_members").select("user_id, group_id, is_admin").eq("module_id", module.id),
    supabase.from("gw_group_members").select("user_id, group_id"),
    supabase.from("gw_profiles").select("id, email, full_name, role, status").eq("status", "active"),
    supabase.from("gw_company_locations").select("*").order("sort_order"),
    supabase.from("gw_member_companies").select("group_id, user_id, company_id"),
  ]);
  // Database without the 20261130110000 billing columns yet (or the 20261129 company
  // columns): fall back to the older column lists
  const companies1 = companies0.error && /billing_address|phone|fax|email/.test(companies0.error.message ?? "")
    ? await supabase.from("gw_companies").select("id, code, name, short_name, registration_no, description, is_active, sort_order, opispro_id, has_locations").order("sort_order").order("name")
    : companies0;
  const companies = companies1.error && /opispro_id|has_locations/.test(companies1.error.message ?? "")
    ? await supabase.from("gw_companies").select("id, code, name, short_name, registration_no, description, is_active, sort_order").order("sort_order").order("name")
    : companies1;
  // Company 底下的 Estate（20261121110000 还没跑时就是空的）
  const estates = await supabase.from("gw_company_estates").select("id, company_id, name, short_name, area, area_unit, sort_order, is_active").order("sort_order").order("name");
  const failed = [businesses, companies, links, tagged, taggedBiz, members, groupMembers, profiles, memberCompanies].find((r) => r.error);
  if (failed?.error) return json({ error: "query_failed", detail: failed.error.message }, 500);

  // Who may use this Icon right now — the same rule as gw__effective_module_ids:
  // active super admins always; others need the Icon opened for them in a
  // Business they belong to that carries the Icon (access is per Business).
  const taggedGroups = new Set((taggedBiz.data ?? []).map((r) => r.group_id));
  const inBusiness = new Set((groupMembers.data ?? []).map((r) => r.group_id + ":" + r.user_id));
  const memberOf = new Map<string, boolean>();
  const iconGroups = new Map<string, Set<string>>(); // user → Businesses where the Icon is opened for them
  for (const r of members.data ?? []) {
    if (!taggedGroups.has(r.group_id) || !inBusiness.has(r.group_id + ":" + r.user_id)) continue;
    memberOf.set(r.user_id, (memberOf.get(r.user_id) ?? false) || r.is_admin === true);
    if (!iconGroups.has(r.user_id)) iconGroups.set(r.user_id, new Set());
    iconGroups.get(r.user_id)!.add(r.group_id);
  }
  // Companies with this Icon: tagged directly, or in a tagged Business
  const iconCompanies = new Set<string>((tagged.data ?? []).map((r) => r.company_id));
  for (const l of links.data ?? []) if (taggedGroups.has(l.group_id)) iconCompanies.add(l.company_id);
  // A person's Companies for this Icon = the Companies HR allocated them to, in the Businesses where they have the Icon
  const companiesOf = (userId: string): string[] => {
    const groups = iconGroups.get(userId);
    if (!groups) return [];
    const out = new Set<string>();
    for (const m of memberCompanies.data ?? []) {
      if (m.user_id === userId && groups.has(m.group_id) && iconCompanies.has(m.company_id)) out.add(m.company_id);
    }
    return [...out];
  };
  const moduleUsers = (profiles.data ?? [])
    .filter((p) => p.role === "super_admin" || memberOf.has(p.id))
    .map((p) => ({
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      is_admin: p.role === "super_admin" || memberOf.get(p.id) === true,
      company_ids: p.role === "super_admin" ? [...iconCompanies] : companiesOf(p.id),
    }));

  return json({
    module_code: module.code,
    module_users: moduleUsers,
    businesses: businesses.data ?? [],
    companies: companies.data ?? [],
    links: links.data ?? [],
    // Opispro ID / has_locations and the billing details (billing_address, phone,
    // fax, email) come with each company; locations is empty until the 20261129 migration has run
    locations: locations.error ? [] : (locations.data ?? []),
    // Estates under a company (MJM Plantation 1 / 2 / 3); a company with none is itself one estate
    estates: estates.error ? [] : (estates.data ?? []),
    module_company_ids: (tagged.data ?? []).map((r) => r.company_id),
    module_business_ids: (taggedBiz.data ?? []).map((r) => r.group_id),
    exported_at: new Date().toISOString(),
  });
});
