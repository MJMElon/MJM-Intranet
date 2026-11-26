// 公开 Gateway Token 的公钥（JWKS），目标系统可用它自行验证 Token 签名
import { corsHeaders, json, publicJwk, withCors } from "../_shared/gw.ts";

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return json({ keys: [publicJwk()] });
}));
