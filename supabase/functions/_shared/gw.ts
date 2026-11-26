// Gateway Edge Functions 共用工具
import { createClient } from "npm:@supabase/supabase-js@2";
import { importJWK, type JWK } from "npm:jose@5";

export const TOKEN_ISSUER = "mjm-gateway";
export const TOKEN_TTL_SECONDS = 60;

// The Intranet's own web addresses (origins). Browsers may call these functions
// only from them. Add a new domain here, or list them in the GW_ALLOWED_ORIGIN
// secret, comma-separated (e.g. "https://intranet.example.com,https://mjmelon.github.io").
// System-to-system calls (Portal, AI connectors) are not affected.
const SITE_ORIGINS = ["https://mjmelon.github.io"];
const originOf = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };
export const ALLOWED_ORIGINS: string[] = [...new Set([
  ...(Deno.env.get("GW_ALLOWED_ORIGIN") ?? "").split(",").map((x) => originOf(x.trim()) || x.trim().replace(/\/+$/, "")).filter(Boolean),
  ...SITE_ORIGINS,
  originOf(Deno.env.get("GW_SITE_URL") ?? ""),
].filter(Boolean))];
export const isAllowedOrigin = (o: string | null | undefined) => !!o && ALLOWED_ORIGINS.includes(o.replace(/\/+$/, ""));

/** Wraps a function's handler: a browser call from one of the Intranet's sites gets that site as Access-Control-Allow-Origin. */
export function withCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await handler(req);
    const origin = req.headers.get("Origin");
    if (!origin || !isAllowedOrigin(origin) || res.status === 101) return res;
    const h = new Headers(res.headers);
    h.set("Access-Control-Allow-Origin", origin);
    h.append("Vary", "Origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };
}

export const corsHeaders = {
  // the first allowed site; withCors() answers each allowed site with its own address
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0] ?? "https://mjmelon.github.io",
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
