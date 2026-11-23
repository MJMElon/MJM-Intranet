// Gateway Edge Functions 共用工具
import { createClient } from "npm:@supabase/supabase-js@2";
import { importJWK, type JWK } from "npm:jose@5";

export const TOKEN_ISSUER = "mjm-gateway";
export const TOKEN_TTL_SECONDS = 60;

export const corsHeaders = {
  // 只有自己的网站可以从浏览器呼叫（可以用 GW_ALLOWED_ORIGIN 改）；系统对系统的呼叫（Portal、AI 连接器）不受影响
  "Access-Control-Allow-Origin": Deno.env.get("GW_ALLOWED_ORIGIN") ?? "https://mjmelon.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gw-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export function userClient(authorization: string) {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
}

// ES256 私钥（JWK JSON）存在 Edge Function secret：GW_TOKEN_PRIVATE_JWK
function privateJwk(): JWK & { kid: string } {
  const raw = Deno.env.get("GW_TOKEN_PRIVATE_JWK");
  if (!raw) throw new Error("GW_TOKEN_PRIVATE_JWK is not set");
  const jwk = JSON.parse(raw);
  if (!jwk.kid) throw new Error("GW_TOKEN_PRIVATE_JWK must include kid");
  return jwk;
}

export async function signingKey() {
  const jwk = privateJwk();
  return { kid: jwk.kid, key: await importJWK(jwk, "ES256") };
}

// 公钥 = 私钥 JWK 去掉 d
export function publicJwk(): JWK {
  const { kty, crv, x, y, kid } = privateJwk();
  return { kty, crv, x, y, kid, alg: "ES256", use: "sig" };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// 记录 Auth 相关事件到 gw_audit_logs（service_role）
export async function logEvent(
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null = null,
  targetLabel: string | null = null,
  after: Record<string, unknown> | null = null,
) {
  const { error } = await serviceClient().rpc("gw_log_event", {
    p_actor: actorId,
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId,
    p_target_label: targetLabel,
    p_after: after,
  });
  if (error) console.error("gw_log_event failed", error.message);
}

// 从 Authorization header 取得当前用户与其 Gateway 资料
export async function getCaller(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const supabase = userClient(authorization);
  const { data: { user } } = await supabase.auth.getUser(authorization.slice(7));
  if (!user) return null;
  const { data: profile } = await supabase.from("gw_profiles").select("*").eq("id", user.id).maybeSingle();
  return { user, profile, supabase };
}

// 临时密码（至少含一个字母和一个数字；排除容易看错的字元）
export function generatePassword(length = 12): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
