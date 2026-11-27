// 给目标系统调用：确认「这个人能不能用这个模块」
// Header：x-gw-api-key（每个模块各自一把，在 Gateway 模块管理里产生）
// 请求：POST { token }               → 验证并兑换 Gateway Token（只能用一次）
//      POST { user_id } 或 { email } → 直接查询某人目前是否有权限
// 回应：{ allowed, module_code, user? }
import { jwtVerify, importJWK } from "npm:jose@5";
import { corsHeaders, json, publicJwk, serviceClient, sha256Hex, TOKEN_ISSUER, withCors } from "../_shared/gw.ts";

Deno.serve(withCors(async (req) => {
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

  const body = await req.json().catch(() => ({}));
  let userId: string | null = null;

  if (typeof body.token === "string") {
    try {
      const key = await importJWK(publicJwk(), "ES256");
      const { payload } = await jwtVerify(body.token, key, { issuer: TOKEN_ISSUER, audience: module.code });
      userId = payload.sub ?? null;
      const { error } = await supabase
        .from("gw_token_redemptions")
        .insert({ jti: payload.jti, user_id: userId, module_id: module.id });
      if (error) return json({ allowed: false, module_code: module.code, error: "token_already_used" }, 409);
    } catch {
      return json({ allowed: false, module_code: module.code, error: "invalid_token" }, 401);
    }
  } else if (typeof body.user_id === "string") {
    userId = body.user_id;
  } else if (typeof body.email === "string") {
    const { data } = await supabase.from("gw_profiles").select("id").eq("email", String(body.email).trim().toLowerCase()).maybeSingle();
    userId = data?.id ?? null;
  } else {
    return json({ error: "token_or_user_required" }, 400);
  }

  if (!userId) return json({ allowed: false, module_code: module.code });

  const [{ data: allowed }, { data: profile }] = await Promise.all([
    supabase.rpc("gw_user_can_access", { p_user: userId, p_module_code: module.code }),
    supabase.from("gw_profiles").select("id, email, full_name, role, avatar_url").eq("id", userId).maybeSingle(),
  ]);
  if (!allowed || !profile) return json({ allowed: false, module_code: module.code });
  // is_super_admin：Intranet 的 Super Admin 在每个接进来的模块也是 Super Admin（模块自己照这个设定）
  return json({ allowed: true, module_code: module.code, user: { id: profile.id, email: profile.email, full_name: profile.full_name, avatar_url: profile.avatar_url || null, is_super_admin: profile.role === "super_admin" } });
}));
