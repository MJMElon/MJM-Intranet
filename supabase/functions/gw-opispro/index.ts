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
//   3) 找不到 → 自动开一个「等待批准」的帐号（停用中 + pending_approval，名字和 email 用 OPIS PRO 的），
//      显示「等待管理员批准」；管理员在 Users 按 Approve（启用）之后就能进来
//   停用中 → 「帐号已停用」；等待批准中 → 「等待管理员批准」
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { ALLOWED_ORIGINS, generatePassword, logEvent, serviceClient, withCors } from "../_shared/gw.ts";
import { type Claims, type Config, callback, clearCookie, start, toLogin } from "./flow.ts";

const issuer = (Deno.env.get("OPISPRO_ISSUER") ?? "https://opispro.com").replace(/\/+$/, "");
const cfg: Config = {
  issuer,
  clientId: Deno.env.get("OPISPRO_OAUTH_CLIENT_ID") ?? "",
  clientSecret: Deno.env.get("OPISPRO_OAUTH_CLIENT_SECRET") ?? "",
  redirectUri: Deno.env.get("OPISPRO_OAUTH_REDIRECT_URI") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/gw-opispro/callback`,
  siteUrl: (Deno.env.get("GW_SITE_URL") ?? "https://mjm.opispro.com/").replace(/\/?$/, "/"),
  allowedOrigins: ALLOWED_ORIGINS, // a login started on any of the Intranet's addresses returns there
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

type SignInError = "no_access" | "disabled" | "pending";

// 第一次用 OPIS PRO 进来、Intranet 没有这个人：开一个等待批准的帐号（不能登入，直到管理员启用）
async function createPending(claims: Claims, email: string): Promise<SignInError> {
  const admin = serviceClient();
  const sub = String(claims.sub);
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL.test(email)) return "no_access";
  const given = [claims.given_name, claims.family_name].filter((x) => typeof x === "string" && x.trim()).join(" ");
  const fullName = (String(claims.name ?? "").trim() || given || email.split("@")[0]).slice(0, 100);

  let userId: string | null = null;
  let created = false;
  const { data: authId } = await admin.rpc("gw_auth_user_id", { p_email: email });
  if (authId) userId = authId as string;
  else {
    // 随机密码（不会给任何人）；封锁到管理员启用为止
    const { data, error } = await admin.auth.admin.createUser({ email, password: generatePassword(24), email_confirm: true, ban_duration: "876000h" });
    if (error || !data.user) {
      console.error("opispro pending createUser failed", error?.code);
      return "no_access";
    }
    userId = data.user.id;
    created = true;
  }
  const { error: pe } = await admin.from("gw_profiles").insert({
    id: userId,
    email,
    full_name: fullName,
    role: "user",
    status: "disabled",
    must_change_password: false,
    opispro_user_id: sub,
    pending_approval: true,
  });
  if (pe) {
    console.error("opispro pending profile failed", pe.code);
    if (created) await admin.auth.admin.deleteUser(userId);
    return "no_access"; // 例如资料库还没加 pending_approval 栏位
  }
  if (!created) await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  await logEvent(userId, "auth.opispro_signup", "profiles", userId, email, { opispro_user_id: sub, name: fullName });
  return "pending";
}

async function signIn(claims: Claims): Promise<{ tokenHash: string } | { error: SignInError }> {
  const admin = serviceClient();
  const sub = String(claims.sub);
  // OPIS PRO 明确说 email 没验证过：不用 email 找人 / 开帐号（免得有人把 email 改成别人的来冒充）
  const emailOk = claims.email_verified !== false && claims.email_verified !== "false";
  const email = emailOk ? String(claims.email ?? "").trim().toLowerCase() : "";
  const cols = "id, email, status, role, opispro_user_id";
  let { data: p } = await admin.from("gw_profiles").select(cols).eq("opispro_user_id", sub).maybeSingle();
  if (!p && email) {
    // 第一次：用 email 找，而且那个人还没连结别的 OPIS PRO 帐号
    const { data: byEmail } = await admin.from("gw_profiles").select(cols).eq("email", email).maybeSingle();
    if (byEmail && byEmail.opispro_user_id && byEmail.opispro_user_id !== sub) {
      await logEvent(null, "auth.opispro_link_conflict", "auth", byEmail.id, email, { opispro_user_id: sub });
      return { error: "no_access" };
    }
    // 超级管理员：只有 OPIS PRO 确认 email 验证过才自动连结；不然要在 Intranet 手动连结
    if (byEmail && byEmail.role === "super_admin" && claims.email_verified !== true && claims.email_verified !== "true") {
      await logEvent(null, "auth.opispro_link_needs_admin", "auth", byEmail.id, email, { opispro_user_id: sub });
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
    // 用 OPIS PRO ID 和 email 都找不到（而且这个 email 没被别人用）：开等待批准的帐号
    if (email) {
      const { data: taken } = await admin.from("gw_profiles").select("id").eq("email", email).maybeSingle();
      if (!taken) return { error: await createPending(claims, email) };
    }
    await logEvent(null, "auth.login_failed", "auth", null, email || `opispro:${sub}`, { method: "opispro", reason: "no_account" });
    return { error: "no_access" };
  }
  if (p.status !== "active") {
    // 等待批准中（栏位还没加时当作一般停用）
    const { data: pend } = await admin.from("gw_profiles").select("pending_approval").eq("id", p.id).maybeSingle();
    return { error: pend?.pending_approval ? "pending" : "disabled" };
  }

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

Deno.serve(withCors(async (req) => {
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
}));
