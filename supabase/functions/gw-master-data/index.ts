// 给接入的系统（例如 CMMS 2）同步主资料：Business、Company、两者的连结，
// 以及哪些 Company 标签了这个 Icon。
// Header：x-gw-api-key（这个 Icon 的 API Key，和 gw-check-access 一样）
// 请求：POST {}      回应：{ module_code, businesses, companies, links, module_company_ids, module_business_ids, exported_at }
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

  const [businesses, companies, links, tagged, taggedBiz] = await Promise.all([
    supabase.from("gw_groups").select("id, name, description, sort_order").order("sort_order").order("name"),
    supabase
      .from("gw_companies")
      .select("id, code, name, short_name, registration_no, description, is_active, sort_order")
      .order("sort_order")
      .order("name"),
    supabase.from("gw_business_companies").select("group_id, company_id"),
    supabase.from("gw_module_companies").select("company_id").eq("module_id", module.id),
    supabase.from("gw_group_modules").select("group_id").eq("module_id", module.id),
  ]);
  const failed = [businesses, companies, links, tagged, taggedBiz].find((r) => r.error);
  if (failed?.error) return json({ error: "query_failed", detail: failed.error.message }, 500);

  return json({
    module_code: module.code,
    businesses: businesses.data ?? [],
    companies: companies.data ?? [],
    links: links.data ?? [],
    module_company_ids: (tagged.data ?? []).map((r) => r.company_id),
    module_business_ids: (taggedBiz.data ?? []).map((r) => r.group_id),
    exported_at: new Date().toISOString(),
  });
});
