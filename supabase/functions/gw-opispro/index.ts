// Sign in with OPIS PRO —— 浏览器直接打开这两个网址（不是 fetch），所以部署时要 --no-verify-jwt
//   GET /functions/v1/gw-opispro/start?next=index.html
//   GET /functions/v1/gw-opispro/callback   ← 登记在 OPIS PRO 的 Callback URL
//
// 要在 Supabase → Edge Functions → Secrets 设定（值由 OPIS PRO 管理员提供，secret 只放这里）：
//   OPISPRO_OAUTH_CLIENT_ID、OPISPRO_OAUTH_CLIENT_SECRET
// 可不设（有预设）：OPISPRO_ISSUER、OPISPRO_OAUTH_REDIRECT_URI、GW_SITE_URL
//
// 谁可以进来：
//   1) gw_profiles.opispro_user_id = sub 的人
//   2) 还没连结的：第一次用同一个 email 找到 Intranet 用户 → 记下 OPIS PRO ID，以后只认 ID
//   3) 找不到 → 「没有 MJM Intranet 权限」；停用中 → 「帐号已停用」（不会自动开帐号）
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { logEvent, serviceClient } from "../_shared/gw.ts";
import { type Claims, type Config, callback, clearCookie, start, toLogin } from "./flow.ts";

const issuer = (Deno.env.get("OPISPRO_ISSUER") ?? "https://opispro.com").replace(/\/+$/, "");
const cfg: Config = {
  issuer,
  clientId: Deno.env.get("OPISPRO_OAUTH_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("OPISPRO_OAUTH_CLIENT_SECRET") ?? "",
  redirectUri: Deno.env.get("OPISPRO_OAUTH_REDIRECT_URI") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/gw-opispro/callback`,
  siteUrl: (Deno.env.get("GW_SITE_URL") ?? "https://mjmelon.github.io/MJM-Intranet/").replace(/\/?$/, "/"),
  scope: "openid profile email",
};
const keys = createRemoteJWKSet(new URL(`${issuer}/oauth/jwks`)); // 钥匙从 JWKS 读，不抄进程式

async function verifyIdToken(idToken: string): Promise<Claims> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer,
    audience: cfg.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 30,
  });
  return payload as Claims;
}

async function signIn(claims: Claims): Promise<{ tokenHash: string } | { error: "no_access" | "disabled" }> {
  const admin = serviceClient();
  const sub = String(claims.sub);
  const email = String(claims.email ?? "").trim().toLowerCase();
  const cols = "id, email, status, opispro_user_id";
  let { data: p } = await admin.from("gw_profiles").select(cols).eq("opispro_user_id", sub).maybeSingle();
  if (!p && email) {
    // 第一次：用 email 找，而且那个人还没连结别的 OPIS PRO 帐号
    const { data: byEmail } = await admin.from("gw_profiles").select(cols).eq("email", email).maybeSingle();
    if (byEmail && byEmail.opispro_user_id && byEmail.opispro_user_id !== sub) {
      await logEvent(null, "auth.opispro_link_conflict", "auth", byEmail.id, email, { opispro_user_id: sub });
      return { error: "no_access" };
    }
    if (byEmail) {
      const { error } = await admin.from("gw_profiles").update({ opispro_user_id: sub }).eq("id", byEmail.id).is("opispro_user_id", null);
      if (error) {
        console.error("opispro link failed", error.code);
        return { error: "no_access" };
      }
      await logEvent(byEmail.id, "auth.opispro_linked", "auth", byEmail.id, email, { opispro_user_id: sub });
      p = { ...byEmail, opispro_user_id: sub };
    }
  }
  if (!p) {
    await logEvent(null, "auth.login_failed", "auth", null, email || `opispro:${sub}`, { method: "opispro", reason: "no_account" });
    return { error: "no_access" };
  }
  if (p.status !== "active") return { error: "disabled" };

  // 登入用的是 Intranet 自己的帐号 email（OPIS PRO 的 email 只用来第一次找人）
  const { data: u, error: ue } = await admin.auth.admin.getUserById(p.id);
  if (ue || !u?.user?.email) return { error: "no_access" };
  if (u.user.banned_until && new Date(u.user.banned_until).getTime() > Date.now()) return { error: "disabled" };
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (le || !tokenHash) {
    console.error("opispro generateLink failed", le?.code ?? "no_hash");
    return { error: "no_access" };
  }
  await admin.rpc("gw_login_succeeded", { p_email: u.user.email });
  await logEvent(p.id, "auth.login", "auth", p.id, u.user.email, { method: "opispro" });
  return { tokenHash };
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
  const path = new URL(req.url).pathname;
  if (!cfg.clientId || !cfg.clientSecret) return toLogin(cfg, "sso_not_ready");
  try {
    if (path.endsWith("/start")) return await start(cfg, req);
    if (path.endsWith("/callback"))
      return await callback(cfg, req, {
        fetch,
        verifyIdToken,
        signIn,
        log: (event, detail) => console.warn(event, JSON.stringify(detail ?? {})),
      });
  } catch (e) {
    console.error("opispro error", e instanceof Error ? e.name : "error");
    return toLogin(cfg, "sso_failed", clearCookie());
  }
  return new Response("not found", { status: 404 });
});
