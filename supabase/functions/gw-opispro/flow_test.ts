// 测试 Sign in with OPIS PRO 流程（假的 OPIS PRO 回应，不用真 token）
// 执行：deno test --allow-net=deno.land supabase/functions/gw-opispro/flow_test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from "npm:jose@5";
import { type Claims, type Config, type Deps, callback, openCookie, s256, safeNext, sealCookie, start } from "./flow.ts";

const cfg: Config = {
  issuer: "https://opispro.com",
  clientId: "mjm-intranet",
  clientSecret: "test-secret-not-real",
  redirectUri: "https://example.supabase.co/functions/v1/gw-opispro/callback",
  siteUrl: "https://mjmelon.github.io/MJM-Intranet/",
  scope: "openid profile email",
};
const CB = cfg.redirectUri;

// 测试用的 RS256 钥匙 + 跟正式一样的验证规则
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
const verifyIdToken = async (t: string) =>
  (await jwtVerify(t, jwks, { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat"], clockTolerance: 30 })).payload as Claims;
const idToken = (claims: Record<string, unknown>, opt: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT({ name: "Aina Rahman", email: "aina@example.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opt.iss ?? cfg.issuer)
    .setAudience(opt.aud ?? cfg.clientId)
    .setSubject("1234")
    .setIssuedAt()
    .setExpirationTime(opt.exp ?? "1h")
    .sign(privateKey);

// 假的 Intranet 用户资料
type P = { id: string; email: string; status: string; opispro_user_id: string | null };
function fakeUsers(list: P[]) {
  const linked: string[] = [];
  const signIn: Deps["signIn"] = async (c) => {
    let p = list.find((x) => x.opispro_user_id === c.sub);
    if (!p && c.email) {
      const e = list.find((x) => x.email === String(c.email).toLowerCase());
      if (e && e.opispro_user_id && e.opispro_user_id !== c.sub) return { error: "no_access" };
      if (e) ((e.opispro_user_id = c.sub), linked.push(e.id), (p = e));
    }
    if (!p) return { error: "no_access" };
    if (p.status !== "active") return { error: "disabled" };
    return { tokenHash: "hash-for-" + p.id };
  };
  return { signIn, linked };
}

// 走一次 start，拿到 OPIS PRO 网址的参数 + cookie
async function begin(next = "admin.html#structure") {
  const res = await start(cfg, new Request(`https://x/functions/v1/gw-opispro/start?next=${encodeURIComponent(next)}`));
  const loc = new URL(res.headers.get("location")!);
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const saved = (await openCookie(cfg, cookie.split("=").slice(1).join("="), Date.now()))!;
  return { res, loc, cookie, saved };
}
function tokenFetch(body: unknown, status = 200, seen?: { body?: URLSearchParams }) {
  return (async (_u: string, init: RequestInit) => {
    if (seen) seen.body = init.body as URLSearchParams;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}
const back = (cookie: string, q: string) => new Request(`${CB}?${q}`, { headers: { cookie } });
const errOf = (r: Response) => new URL(r.headers.get("location")!).searchParams.get("error");
const deps = (over: Partial<Deps>): Deps => ({ fetch: tokenFetch({}), verifyIdToken, signIn: fakeUsers([]).signIn, log: () => {}, ...over });

Deno.test("start: redirects to OPIS PRO with S256 PKCE and a signed httpOnly cookie", async () => {
  const { res, loc, saved } = await begin();
  assertEquals(res.status, 302);
  assertEquals(loc.origin + loc.pathname, "https://opispro.com/oauth/authorize");
  assertEquals(loc.searchParams.get("code_challenge_method"), "S256");
  assertEquals(loc.searchParams.get("code_challenge"), await s256(saved.verifier));
  assertEquals(loc.searchParams.get("state"), saved.state);
  assertEquals(loc.searchParams.get("nonce"), saved.nonce);
  assertEquals(loc.searchParams.get("scope"), "openid profile email");
  assert(new Set([saved.state, saved.nonce, saved.verifier]).size === 3 && saved.state.length >= 43);
  const sc = res.headers.get("set-cookie")!;
  for (const a of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) assert(sc.includes(a), a);
  assertEquals(saved.next, "admin.html#structure");
  assert((await begin()).saved.state !== saved.state); // 每次都是新的
});

Deno.test("next only accepts Intranet pages", () => {
  assertEquals(safeNext("https://evil.com"), "index.html");
  assertEquals(safeNext("//evil.com/a.html"), "index.html");
  assertEquals(safeNext("javascript:alert(1)"), "index.html");
  assertEquals(safeNext("login.html"), "index.html");
  assertEquals(safeNext("library.html?f=1"), "library.html?f=1");
});

Deno.test("returning user (already linked by sub) signs in", async () => {
  const { cookie, saved } = await begin();
  const users = fakeUsers([{ id: "u1", email: "old@mjm.com", status: "active", opispro_user_id: "1234" }]);
  const seen: { body?: URLSearchParams } = {};
  const r = await callback(cfg, back(cookie, `code=abc&state=${saved.state}`), deps({ fetch: tokenFetch({ id_token: await idToken({ nonce: saved.nonce }) }, 200, seen), signIn: users.signIn }));
  const loc = r.headers.get("location")!;
  assert(loc.startsWith(cfg.siteUrl + "login.html?mode=sso#th=hash-for-u1&next=admin.html%23structure"), loc);
  assertEquals(seen.body!.get("code_verifier"), saved.verifier);
  assertEquals(seen.body!.get("grant_type"), "authorization_code");
  assert(r.headers.get("set-cookie")!.includes("Max-Age=0")); // 登入资料删掉
  assertEquals(users.linked, []);
});

Deno.test("first-time user is linked by email once, then by ID", async () => {
  const list = [{ id: "u2", email: "aina@example.com", status: "active", opispro_user_id: null as string | null }];
  const users = fakeUsers(list);
  const a = await begin();
  const r = await callback(cfg, back(a.cookie, `code=c1&state=${a.saved.state}`), deps({ fetch: tokenFetch({ id_token: await idToken({ nonce: a.saved.nonce }) }), signIn: users.signIn }));
  assert(r.headers.get("location")!.includes("th=hash-for-u2"));
  assertEquals(list[0].opispro_user_id, "1234");
  // 之后 OPIS PRO 的 email 换了，还是认得（用 ID）
  const b = await begin();
  const r2 = await callback(cfg, back(b.cookie, `code=c2&state=${b.saved.state}`), deps({ fetch: tokenFetch({ id_token: await idToken({ nonce: b.saved.nonce, email: "new@else.com" }) }), signIn: users.signIn }));
  assert(r2.headers.get("location")!.includes("th=hash-for-u2"));
});

Deno.test("no Intranet account / disabled / email already linked to someone else → refused", async () => {
  const cases: [P[], string][] = [
    [[], "no_access"],
    [[{ id: "u3", email: "aina@example.com", status: "disabled", opispro_user_id: "1234" }], "disabled"],
    [[{ id: "u4", email: "aina@example.com", status: "active", opispro_user_id: "9999" }], "no_access"],
  ];
  for (const [list, want] of cases) {
    const { cookie, saved } = await begin();
    const r = await callback(cfg, back(cookie, `code=c&state=${saved.state}`), deps({ fetch: tokenFetch({ id_token: await idToken({ nonce: saved.nonce }) }), signIn: fakeUsers(list).signIn }));
    assertEquals(errOf(r), want);
  }
});

Deno.test("state mismatch, missing or forged cookie → sso_expired, code never used", async () => {
  const { cookie, saved } = await begin();
  let called = false;
  const f = (async () => ((called = true), new Response("{}"))) as unknown as typeof fetch;
  assertEquals(errOf(await callback(cfg, back(cookie, `code=c&state=${saved.state}x`), deps({ fetch: f }))), "sso_expired");
  assertEquals(errOf(await callback(cfg, new Request(`${CB}?code=c&state=${saved.state}`), deps({ fetch: f }))), "sso_expired");
  const forged = await sealCookie({ ...cfg, clientSecret: "other" }, { ...saved });
  assertEquals(errOf(await callback(cfg, back(`__Host-gw_opispro=${forged}`, `code=c&state=${saved.state}`), deps({ fetch: f }))), "sso_expired");
  const old = await sealCookie(cfg, { ...saved, exp: Date.now() - 1 });
  assertEquals(errOf(await callback(cfg, back(`__Host-gw_opispro=${old}`, `code=c&state=${saved.state}`), deps({ fetch: f }))), "sso_expired");
  assertEquals(called, false);
});

Deno.test("nonce mismatch → sso_failed", async () => {
  const { cookie, saved } = await begin();
  const r = await callback(cfg, back(cookie, `code=c&state=${saved.state}`), deps({ fetch: tokenFetch({ id_token: await idToken({ nonce: "someone-else" }) }), signIn: fakeUsers([{ id: "u1", email: "a@b", status: "active", opispro_user_id: "1234" }]).signIn }));
  assertEquals(errOf(r), "sso_failed");
});

Deno.test("ID token with wrong issuer / audience / expired / bad signature → sso_failed", async () => {
  const other = await generateKeyPair("RS256");
  const bad = [
    await idToken({}, { iss: "https://evil.com" }),
    await idToken({}, { aud: "another-app" }),
    await idToken({}, { exp: "-5m" }),
    await new SignJWT({ email: "aina@example.com" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(cfg.issuer).setAudience(cfg.clientId).setSubject("1234").setIssuedAt().setExpirationTime("1h").sign(other.privateKey),
  ];
  for (const t of bad) {
    const { cookie, saved } = await begin();
    void saved.nonce; // 签名 / iss / aud / exp 本身就该失败
    const r = await callback(cfg, back(cookie, `code=c&state=${saved.state}`), deps({ fetch: tokenFetch({ id_token: t }), signIn: fakeUsers([{ id: "u1", email: "a@b", status: "active", opispro_user_id: "1234" }]).signIn }));
    assertEquals(errOf(r), "sso_failed");
  }
});

Deno.test("failed token exchange: invalid_grant / invalid_client → sso_failed; 5xx or network → sso_unreachable", async () => {
  for (const [status, want] of [[400, "sso_failed"], [401, "sso_failed"], [503, "sso_unreachable"]] as const) {
    const { cookie, saved } = await begin();
    const logs: string[] = [];
    const r = await callback(cfg, back(cookie, `code=c&state=${saved.state}`), deps({ fetch: tokenFetch({ error: status === 401 ? "invalid_client" : "invalid_grant" }, status), log: (e, d) => logs.push(e + JSON.stringify(d)) }));
    assertEquals(errOf(r), want);
    assert(!logs.join().includes(saved.verifier) && !logs.join().includes(cfg.clientSecret)); // 不记录秘密
  }
  const { cookie, saved } = await begin();
  const down = (async () => {
    throw new TypeError("network");
  }) as unknown as typeof fetch;
  assertEquals(errOf(await callback(cfg, back(cookie, `code=c&state=${saved.state}`), deps({ fetch: down }))), "sso_unreachable");
});

Deno.test("Cancel on OPIS PRO → sso_cancelled; other error → sso_failed", async () => {
  const { cookie, saved } = await begin();
  assertEquals(errOf(await callback(cfg, back(cookie, `error=access_denied&state=${saved.state}`), deps({}))), "sso_cancelled");
  assertEquals(errOf(await callback(cfg, back(cookie, `error=server_error&state=${saved.state}`), deps({}))), "sso_failed");
});
