// 发布时执行（.github/workflows/pages.yml）：每个网页加上 Content-Security-Policy
//  - 脚本只能来自自己的网站（shared/…）＋ 网页里那几段写死的脚本（用 sha256 指纹，改了内容就要重新算，所以发布时才算）
//  - 资料只能送到自己的 Supabase、天气、地名服务：就算被插入坏程式，也送不出去
//  - 图片只能来自自己的网站和 Supabase 储存
// 用法：node scripts/csp.mjs [网站根目录，预设 .]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] || ".";
const config = readFileSync(join(root, "shared/config.js"), "utf8");
const supabase = (config.match(/supabaseUrl:\s*"([^"]+)"/) || [])[1];
if (!supabase) throw new Error("supabaseUrl not found in shared/config.js");
const ws = supabase.replace(/^https:/, "wss:");

const policyFor = (hashes) =>
  [
    "default-src 'self'",
    `script-src 'self' ${hashes.map((h) => `'sha256-${h}'`).join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${ws} https://api.open-meteo.com https://api.bigdatacloud.net`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

for (const name of readdirSync(root).filter((f) => f.endsWith(".html"))) {
  const file = join(root, name);
  let html = readFileSync(file, "utf8");
  if (html.includes("Content-Security-Policy")) continue;
  const hashes = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.push(createHash("sha256").update(m[1], "utf8").digest("base64"));
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policyFor([...new Set(hashes)])}">`;
  const at = html.search(/<meta charset[^>]*>/i);
  if (at < 0) throw new Error(`${name}: no <meta charset>`);
  const end = html.indexOf(">", at) + 1;
  html = html.slice(0, end) + "\n" + meta + html.slice(end);
  writeFileSync(file, html);
  console.log(`${name}: CSP added (${hashes.length} inline script${hashes.length === 1 ? "" : "s"})`);
}
