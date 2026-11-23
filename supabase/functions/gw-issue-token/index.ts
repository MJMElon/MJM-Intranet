// 第 2 级接入：给已登录、且有该模块权限的用户签发 60 秒有效的 JWT
// 请求：POST { module_code }，Header 带用户的 Supabase Access Token
// 回应：{ token, expires_in, redirect_url }
import { SignJWT } from "npm:jose@5";
import { corsHeaders, json, signingKey, TOKEN_ISSUER, TOKEN_TTL_SECONDS, userClient } from "../_shared/gw.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const { module_code } = await req.json().catch(() => ({}));
  if (typeof module_code !== "string" || !module_code) return json({ error: "module_code_required" }, 400);

  const supabase = userClient(authorization);
  const { data: { user }, error: userError } = await supabase.auth.getUser(authorization.slice(7));
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  // 权限检查在数据库做（帐号停用、模块下架、个人禁止都会返回 false）
  // 权限、模块资料、签名钥匙同时拿（以前一个等一个，开模块比较慢）
  const [{ data: allowed, error: accessError }, { data: module }, { kid, key }] = await Promise.all([
    supabase.rpc("gw_user_can_access", { p_user: user.id, p_module_code: module_code }),
    supabase.from("gw_modules").select("id, code, url, access_level").eq("code", module_code).maybeSingle(),
    signingKey(),
  ]);
  if (accessError) return json({ error: "access_check_failed" }, 500);
  if (!allowed) return json({ error: "forbidden" }, 403);
  if (!module || module.access_level !== 2) return json({ error: "module_not_token_enabled" }, 400);

  const token = await new SignJWT({ mod: module.code, email: user.email })
    .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(module.code)
    .setSubject(user.id)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);

  // 开启记录：回应送出后再写，不用让使用者等
  const record = supabase.rpc("gw_record_open", { p_module: module.id }).then(() => {}, () => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(record);
  else await record;

  const redirect = new URL(module.url);
  redirect.searchParams.set("gw_token", token);
  return json({ token, expires_in: TOKEN_TTL_SECONDS, redirect_url: redirect.toString() });
});
