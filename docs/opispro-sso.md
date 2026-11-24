# Sign in with OPIS PRO

The login page has a **Sign in with OPIS PRO** button above the email/password form (both kept).
It follows the OPIS PRO integration guide: OpenID Connect, Authorization Code + PKCE `S256`, issuer `https://opispro.com`.

## How it works

| Step | Where |
| --- | --- |
| Button → `…/functions/v1/gw-opispro/start?next=<page>` | `login.html` |
| New `state`, `nonce`, `code_verifier` → signed httpOnly cookie (`SameSite=Lax`, 10 min) → redirect to OPIS PRO | `supabase/functions/gw-opispro/flow.ts` `start()` |
| Callback: delete cookie, check `error`, compare `state`, exchange code on the server (10 s timeout), verify ID token (RS256 via JWKS, `iss`, `aud`, `exp`, `nonce`) | `flow.ts` `callback()` |
| Find the Intranet user: by `gw_profiles.opispro_user_id` = `sub`; if none, once by email (then the ID is saved); otherwise refuse | `index.ts` `signIn()` |
| One-time login code (Supabase magic-link hash, in the URL `#`) → `login.html?mode=sso` → `verifyOtp` → session | `index.ts`, `login.html` |

- No accounts are created automatically: someone with no Intranet account sees "no access to MJM Intranet".
- People signed in through OPIS PRO are not forced to set an Intranet password.
- Intranet name and login email stay under admin control (OPIS PRO's email is only used for the first match).
- Super Admin can see, type or clear a person's OPIS PRO ID in the user window (blank = link on first sign-in).
- Logging out ends only the Intranet session.

## Setup

1. Ask the OPIS PRO admin to register the app:
   - App name: **MJM Intranet**
   - Callback URL: `https://briqzyxfxsvulyizzbiu.supabase.co/functions/v1/gw-opispro/callback`
   - Scopes: `openid profile email`
   - Internal system: Yes
2. Supabase (Intranet project) → Edge Functions → Secrets:
   - `OPISPRO_OAUTH_CLIENT_ID`
   - `OPISPRO_OAUTH_CLIENT_SECRET` (never in the repo, chat or browser code)
   - Optional: `OPISPRO_ISSUER` (default `https://opispro.com`), `OPISPRO_OAUTH_REDIRECT_URI` (default above), `GW_SITE_URL` (default `https://mjmelon.github.io/MJM-Intranet/`)
3. Run `supabase/migrations/20261201210000_gw_opispro_sso.sql`.
4. The function deploys from `.github/workflows/functions.yml` (with `--no-verify-jwt`, because the browser opens it directly).

## Tests

```
deno test --allow-net supabase/functions/gw-opispro/flow_test.ts
```

Covers state mismatch / forged / expired cookie, nonce mismatch, bad ID tokens (issuer, audience, expiry, signature), failed token exchange (400, 401, 5xx, network), Cancel, first-time (email link) and returning (ID) users, refused users, and `next` checks.
