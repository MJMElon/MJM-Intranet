// Sign in with OPIS PRO（OpenID Connect，Authorization Code + PKCE S256）
// 这里只放流程本身（不碰资料库），方便用假的 OPIS PRO 回应测试；资料库部分由 index.ts 传进来。
//
//   GET …/gw-opispro/start?next=index.html
//     → 产生 state / nonce / code_verifier，存进签名的 httpOnly cookie（10 分钟），转去 OPIS PRO
//   GET …/gw-opispro/callback?code=…&state=…
//     → 取出并删除 cookie → 检查 error / state → 在伺服器换 token → 验证 ID token
//     → 找 Intranet 用户 → 产生一次性登录码 → 回到 login.html?mode=sso#th=…

export type Config = {
  issuer: string; // https://opispro.com
  clientId: string;
  clientSecret: string;
  redirectUri: string; // 这个 function 的 /callback（要跟 OPIS PRO 登记的一模一样）
  siteUrl: string; // Intranet 网站，结尾有 / (default)
  allowedOrigins?: string[]; // the Intranet's own web addresses; a login started on one of them returns there
  scope: string;
};

export type Claims = { sub: string; email?: string; name?: string; [k: string]: unknown };

export type Deps = {
  fetch: typeof fetch;
  // 验证 ID token（签名 RS256、iss、aud、exp）；失败就丢错误
  verifyIdToken: (idToken: string) => Promise<Claims>;
  // 找 Intranet 用户并产生一次性登录码；没有权限回 error
  signIn: (claims: Claims) => Promise<{ tokenHash: string } | { error: "no_access" | "disabled" | "pending" }>;
  log: (event: string, detail?: Record<string, unknown>) => void; // 不可以放 token / code / secret
  now?: () => number;
};

const COOKIE = "__Host-gw_opispro";
const TTL_MS = 10 * 60 * 1000;
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
export const randomValue = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function s256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

// 两个字串一样吗（时间固定，不让人从回应时间猜）
export function sameText(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 登入后要去的页面：只接受 Intranet 自己的页面（例如 index.html、admin.html#structure）
export function safeNext(next: string | null | undefined): string {
  const v = String(next ?? "");
  return /^[a-z0-9-]+\.html(\?[\w=&.%-]*)?(#[\w-]*)?$/.test(v) && !v.startsWith("login.html") ? v : "index.html";
}

// cookie 签名的钥匙：从 client secret 衍生（不用多一个 secret）
async function cookieKey(cfg: Config) {
  const base = await crypto.subtle.importKey("raw", enc.encode(cfg.clientSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", base, enc.encode("gw-opispro-cookie-v1"));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
// popup：电脑上用小视窗登入时，登录页给的一个随机代号（回来时带回去，让原本的页面认得是自己的视窗）
type Saved = { state: string; nonce: string; verifier: string; next: string; exp: number; popup?: string; site?: string };
export const safePopup = (v: string | null | undefined) => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v ?? "")) ? String(v) : "");
const popupQ = (p?: string) => (p ? `&popup=${p}` : "");
export async function sealCookie(cfg: Config, data: Saved): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(data)));
  const sig = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await cookieKey(cfg), enc.encode(body))));
  return `${body}.${sig}`;
}
export async function openCookie(cfg: Config, value: string | null, now: number): Promise<Saved | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await cookieKey(cfg), fromB64url(sig).buffer as ArrayBuffer, enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Saved;
    if (!data || typeof data.exp !== "number" || data.exp < now) return null;
    return data;
  } catch {
    return null;
  }
}
function readCookie(req: Request): string | null {
  const all = req.headers.get("cookie") ?? "";
  for (const part of all.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}
const setCookie = (value: string, maxAge: number) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => setCookie("", 0);

function redirect(to: string, cookie?: string): Response {
  const h = new Headers({ Location: to, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (cookie) h.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers: h });
}
/** The Intranet site (folder of login.html, ending in /) a login started from —
 *  only one of the Intranet's own addresses; otherwise the default site. */
export function safeSite(cfg: Config, v: string | null | undefined): string {
  try {
    const u = new URL(String(v ?? ""));
    if (u.protocol !== "https:" || u.username || u.password) return cfg.siteUrl;
    if (!(cfg.allowedOrigins ?? []).includes(u.origin) && u.origin !== new URL(cfg.siteUrl).origin) return cfg.siteUrl;
    return u.origin + u.pathname.replace(/[^/]*$/, "");
  } catch { return cfg.siteUrl; }
}
// 失败一律回登录页并带原因（登录页显示对应讯息 + 可以再试）
export const toLogin = (cfg: Config, error: string, cookie?: string, popup?: string, site?: string) =>
  redirect(`${site || cfg.siteUrl}login.html?error=${encodeURIComponent(error)}${popupQ(popup)}`, cookie);

export async function start(cfg: Config, req: Request, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  // Where to come back: the Intranet site the login page is on (?site=, else the page that linked here)
  const site = safeSite(cfg, url.searchParams.get("site") || req.headers.get("referer"));
  const saved: Saved = { state: randomValue(), nonce: randomValue(), verifier: randomValue(), next: safeNext(url.searchParams.get("next")), exp: now + TTL_MS, popup: safePopup(url.searchParams.get("popup")), site };
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scope,
    state: saved.state,
    nonce: saved.nonce,
    code_challenge: await s256(saved.verifier),
    code_challenge_method: "S256",
  });
  return redirect(`${cfg.issuer}/oauth/authorize?${q}`, setCookie(await sealCookie(cfg, saved), TTL_MS / 1000));
}

export async function callback(cfg: Config, req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const clear = clearCookie(); // 不论结果都删掉这次的登入资料
  // 1) 取出这次登入存的资料
  const saved = await openCookie(cfg, readCookie(req), (deps.now ?? Date.now)());
  const popup = saved ? safePopup(saved.popup) : "";
  const site = safeSite(cfg, saved?.site);
  const fail = (code: string) => toLogin(cfg, code, clear, popup, site);
  // 2) OPIS PRO 回传错误（按了 Cancel 等）
  const err = url.searchParams.get("error");
  if (err) {
    if (err === "access_denied") return fail("sso_cancelled");
    deps.log("opispro.callback_error", { error: err.slice(0, 60) });
    return fail("sso_failed");
  }
  // 3) state 要一模一样，才使用 code
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!saved || !state || !sameText(state, saved.state)) return fail("sso_expired");
  if (!code) return fail("sso_failed");

  // 4) 在伺服器换 token（10 秒逾时）
  let tokens: { id_token?: string };
  try {
    const res = await deps.fetch(`${cfg.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "MJM-Intranet/1.0" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code_verifier: saved.verifier,
        code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 500) {
      deps.log("opispro.token_unreachable", { status: res.status });
      return fail("sso_unreachable");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // invalid_client = 伺服器设定（client ID / secret）有错；invalid_grant = code 过期或重用
      deps.log("opispro.token_rejected", { status: res.status, error: String(body?.error ?? "").slice(0, 60) });
      return fail("sso_failed");
    }
    tokens = body;
  } catch (e) {
    deps.log("opispro.token_unreachable", { reason: e instanceof Error ? e.name : "error" });
    return fail("sso_unreachable");
  }
  if (!tokens.id_token) {
    deps.log("opispro.token_rejected", { error: "no_id_token" });
    return fail("sso_failed");
  }

  // 5) 验证 ID token：签名 / iss / aud / exp（verifyIdToken）+ nonce
  let claims: Claims;
  try {
    claims = await deps.verifyIdToken(tokens.id_token);
  } catch (e) {
    deps.log("opispro.id_token_invalid", { reason: e instanceof Error ? e.message.slice(0, 120) : "invalid" });
    return fail("sso_failed");
  }
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, saved.nonce)) {
    deps.log("opispro.id_token_invalid", { reason: "nonce" });
    return fail("sso_failed");
  }
  if (!claims.sub) return fail("sso_failed");

  // 6) 找 Intranet 用户 → 一次性登录码（放在 # 后面，不会送到任何伺服器的记录）
  const r = await deps.signIn({ ...claims, sub: String(claims.sub) });
  if ("error" in r) return fail(r.error);
  return redirect(`${site}login.html?mode=sso${popupQ(popup)}#th=${encodeURIComponent(r.tokenHash)}&next=${encodeURIComponent(saved.next)}`, clear);
}
