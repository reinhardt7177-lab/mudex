// 힉스필드 MCP OAuth 로그인 시험
// 순서: 보호 자원 메타데이터 → 인증 서버 메타데이터 → 동적 클라이언트 등록 → PKCE 인가(브라우저)
//      → 127.0.0.1 콜백으로 코드 받기 → 토큰 교환 → MCP initialize → tools/list → balance 호출
// 토큰은 .secrets/에만 저장하고 화면에는 찍지 않는다.
//
// 실행: node probe/hf_login.mjs            (저장된 토큰이 있으면 재사용, 없으면 로그인)
//       node probe/hf_login.mjs --fresh    (새로 로그인)
//       node probe/hf_login.mjs --as=mcp   (mcp.higgsfield.ai 자체 인증 서버 경로로 시험)

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS = path.join(ROOT, ".secrets");
const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const args = new Set(process.argv.slice(2));
const AS_MODE = [...args].find((a) => a.startsWith("--as="))?.slice(5) ?? "spec";

fs.mkdirSync(SECRETS, { recursive: true });
const log = (...a) => console.log("[hf]", ...a);
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: r.headers, body };
}

async function discover() {
  const pr = await getJson("https://mcp.higgsfield.ai/.well-known/oauth-protected-resource/mcp");
  log("1. 보호 자원 메타데이터:", pr.status, "인증 서버 =", pr.body.authorization_servers);
  const asBase = AS_MODE === "mcp" ? "https://mcp.higgsfield.ai" : pr.body.authorization_servers[0];
  const as = await getJson(`${asBase}/.well-known/oauth-authorization-server`);
  log("2. 인증 서버 메타데이터:", as.status, as.body.issuer);
  return { resource: pr.body.resource, scopes: pr.body.scopes_supported, as: as.body };
}

async function register(as) {
  const file = path.join(SECRETS, `hf_client_${AS_MODE}.json`);
  const cached = readJson(file);
  if (cached?.redirect_uris?.includes(REDIRECT)) { log("3. 등록된 클라이언트 재사용"); return cached; }
  const r = await getJson(as.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Mudex (무덱스)",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  log("3. 동적 클라이언트 등록:", r.status);
  if (r.status >= 300) throw new Error("등록 거부: " + JSON.stringify(r.body));
  writeJson(file, r.body);
  return r.body;
}

function openBrowser(url) {
  // cmd의 start는 &를 끊으므로 rundll32로 연다
  spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get("error");
      const code = u.searchParams.get("code");
      const state = u.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (err || !code || state !== expectedState) {
        res.end("<h2>무덱스: 로그인 실패</h2><p>창을 닫고 프로그램 화면을 확인하세요.</p>");
        server.close();
        reject(new Error(`콜백 오류: ${err ?? ""} ${u.searchParams.get("error_description") ?? ""} state일치=${state === expectedState}`));
        return;
      }
      res.end("<h2>무덱스: 힉스필드 로그인 완료</h2><p>이 창은 닫아도 됩니다.</p>");
      server.close();
      resolve({ code, iss: u.searchParams.get("iss") });
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
    setTimeout(() => { server.close(); reject(new Error("15분 안에 로그인이 끝나지 않음")); }, 15 * 60 * 1000);
  });
}

async function login() {
  const { resource, scopes, as } = await discover();
  const client = await register(as);
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const authUrl = new URL(as.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  }).toString();
  log("4. 브라우저에서 힉스필드 로그인 창을 엽니다. 로그인 후 '허용'을 눌러 주세요.");
  log("   (창이 안 뜨면 이 주소를 직접 여세요)", authUrl.toString());
  const wait = waitForCode(state);
  openBrowser(authUrl.toString());
  const { code } = await wait;
  log("5. 인가 코드 받음 (127.0.0.1 콜백 정상)");
  const tok = await getJson(as.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
      resource,
    }),
  });
  log("6. 토큰 교환:", tok.status, tok.status < 300 ? `(access_token 받음, refresh_token ${tok.body.refresh_token ? "있음" : "없음"}, 만료 ${tok.body.expires_in}s)` : JSON.stringify(tok.body));
  if (tok.status >= 300) throw new Error("토큰 교환 실패");
  const saved = { ...tok.body, obtained_at: Date.now(), token_endpoint: as.token_endpoint, client_id: client.client_id, resource };
  writeJson(path.join(SECRETS, "hf_token.json"), saved);
  return saved;
}

async function refresh(t) {
  if (!t.refresh_token) return null;
  const r = await getJson(t.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: t.resource }),
  });
  log("토큰 갱신:", r.status);
  if (r.status >= 300) return null;
  const saved = { ...t, ...r.body, obtained_at: Date.now() };
  writeJson(path.join(SECRETS, "hf_token.json"), saved);
  return saved;
}

// --- MCP (Streamable HTTP) ---
let sessionId = null;
let nextId = 1;
async function mcp(token, method, params, isNotification = false) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  if (!isNotification) msg.id = nextId++;
  const r = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(msg) });
  sessionId = r.headers.get("mcp-session-id") ?? sessionId;
  if (isNotification) return { status: r.status };
  const text = await r.text();
  if (r.status >= 300) return { status: r.status, error: text.slice(0, 500) };
  if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const datas = text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    for (const d of datas) { try { const j = JSON.parse(d); if (j.id === msg.id) return { status: r.status, ...j }; } catch {} }
    return { status: r.status, error: "SSE에서 응답 못 찾음" };
  }
  return { status: r.status, ...JSON.parse(text) };
}

async function main() {
  let t = args.has("--fresh") ? null : readJson(path.join(SECRETS, "hf_token.json"));
  if (t && Date.now() > t.obtained_at + (t.expires_in ?? 0) * 1000 - 60_000) t = await refresh(t);
  if (!t) t = await login();
  else log("저장된 토큰 사용");

  const init = await mcp(t.access_token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mudex", version: "0.1.0" },
  });
  if (init.error) { log("7. MCP initialize 실패:", init.status, JSON.stringify(init.error).slice(0, 300)); process.exit(1); }
  log("7. MCP initialize:", init.status, init.result?.serverInfo);
  await mcp(t.access_token, "notifications/initialized", null, true);

  const list = await mcp(t.access_token, "tools/list", {});
  const tools = list.result?.tools ?? [];
  log(`8. tools/list: ${tools.length}개`);
  writeJson(path.join(ROOT, "probe", "hf_tools.json"), tools.map((x) => ({ name: x.name, description: (x.description ?? "").slice(0, 300), inputSchema: x.inputSchema })));
  log("   ", tools.map((x) => x.name).join(", "));

  const bal = await mcp(t.access_token, "tools/call", { name: "balance", arguments: {} });
  log("9. balance 호출:", bal.status, bal.error ? JSON.stringify(bal.error).slice(0, 300) : "");
  const content = bal.result?.content ?? [];
  for (const c of content) if (c.type === "text") console.log(c.text.slice(0, 1500));
  if (bal.result?.structuredContent) console.log(JSON.stringify(bal.result.structuredContent).slice(0, 1500));
}

main().catch((e) => { console.error("[hf] 실패:", e.message); process.exit(1); });
