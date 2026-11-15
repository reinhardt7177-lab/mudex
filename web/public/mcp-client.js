// 원격 MCP 클라이언트(웹판): OAuth 2.1(동적 등록 + PKCE) 로그인은 팝업 창으로, 도구 호출은 MCP Streamable HTTP로.
// 브라우저 직접 호출을 막는 MCP 서버(힉스필드 mcp.higgsfield.ai)는 우리 워커(/proxy)를 거친다. 워커는 넘기기만 하고 저장하지 않는다.
// 토큰은 이 브라우저의 localStorage에만 둔다(공용 PC면 '연결 끊기'로 지운다).
export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";
const PROXY_HOSTS = ["mcp.higgsfield.ai"];

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export function pfetch(url, opts) {
  const u = new URL(url);
  return PROXY_HOSTS.includes(u.host) ? fetch(`/proxy?u=${encodeURIComponent(url)}`, opts) : fetch(url, opts);
}
async function getJson(url, opts) {
  const r = await pfetch(url, opts);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

export class McpClient {
  constructor({ url = HIGGSFIELD_MCP_URL, key = "hf", label = "힉스필드" } = {}) {
    this.url = url; this.label = label;
    this.tokenKey = `mudex.mcp.${key}.token`;
    this.clientKey = `mudex.mcp.${key}.client`;
    this.session = null; this.nextId = 1; this.pendingLogin = null;
  }
  get token() { return store.get(this.tokenKey); }
  get loggedIn() { return !!this.token; }
  logout() { store.del(this.tokenKey); this.session = null; }

  async discover() {
    const u = new URL(this.url);
    let pr = await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`).catch(() => null);
    if (!pr || pr.status >= 300 || typeof pr.body !== "object") pr = await getJson(`${u.origin}/.well-known/oauth-protected-resource`).catch(() => null);
    const prm = pr && pr.status < 300 && typeof pr.body === "object" ? pr.body : {};
    const asBase = (prm.authorization_servers?.[0] ?? u.origin).replace(/\/$/, "");
    let as = await getJson(`${asBase}/.well-known/oauth-authorization-server`).catch(() => null);
    if (!as || as.status >= 300 || typeof as.body !== "object") as = await getJson(`${asBase}/.well-known/openid-configuration`).catch(() => null);
    if (!as || as.status >= 300 || !as.body.authorization_endpoint) throw new Error(`${this.label}: 로그인 서버 정보를 찾지 못했습니다. 주소를 확인해 주세요.`);
    return { resource: prm.resource ?? this.url, scopes: prm.scopes_supported ?? as.body.scopes_supported ?? [], as: as.body };
  }

  redirect() { return `${location.origin}/oauth/callback`; }

  async register(as) {
    const saved = store.get(this.clientKey);
    if (saved?.redirect_uris?.includes(this.redirect())) return saved;
    if (!as.registration_endpoint) throw new Error(`${this.label}: 이 서버는 자동 등록(동적 클라이언트 등록)을 지원하지 않습니다.`);
    const r = await getJson(as.registration_endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Mudex Web (무덱스)", redirect_uris: [this.redirect()], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
    });
    if (r.status >= 300) throw new Error(`${this.label}가 등록을 거절했습니다: ${JSON.stringify(r.body).slice(0, 200)}`);
    store.set(this.clientKey, r.body);
    return r.body;
  }

  // 팝업으로 로그인. 끝나면 토큰을 저장하고 resolve. 팝업이 막히면 주소를 돌려줘 화면이 버튼으로 열게 한다.
  async startLogin() {
    if (this.pendingLogin) return this.pendingLogin;
    const { resource, scopes, as } = await this.discover();
    const client = await this.register(as);
    const verifier = rand(32), state = rand(16);
    const url = new URL(as.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code", client_id: client.client_id, redirect_uri: this.redirect(), scope: scopes.join(" "),
      state, code_challenge: await sha256(verifier), code_challenge_method: "S256", resource,
    }).toString();
    const pre = window.__mudexPopup; window.__mudexPopup = null;
    let popup = pre && !pre.closed ? pre : null;
    if (popup) popup.location.href = url.toString(); else popup = window.open(url.toString(), "mudex-oauth", "width=520,height=720");
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("15분 안에 로그인이 끝나지 않았습니다.")), 15 * 60 * 1000);
      const onMsg = async (e) => {
        if (e.origin !== location.origin || e.data?.type !== "mudex-oauth" || e.data.state !== state) return;
        if (e.data.error || !e.data.code) return finish(new Error(e.data.error_description ?? e.data.error ?? "로그인하지 못했습니다."));
        try {
          const tok = await getJson(as.token_endpoint, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "authorization_code", code: e.data.code, redirect_uri: this.redirect(), client_id: client.client_id, code_verifier: verifier, resource }),
          });
          if (tok.status >= 300) throw new Error("토큰 교환 실패 " + tok.status);
          store.set(this.tokenKey, { ...tok.body, obtained_at: Date.now(), token_endpoint: as.token_endpoint, client_id: client.client_id, resource });
          this.session = null;
          finish();
        } catch (err) { finish(err); }
      };
      const finish = (err) => { clearTimeout(timer); window.removeEventListener("message", onMsg); this.pendingLogin = null; err ? reject(err) : resolve(); };
      window.addEventListener("message", onMsg);
    });
    done.catch(() => {});
    this.pendingLogin = { url: url.toString(), done, blocked: !popup };
    return this.pendingLogin;
  }

  async refreshIfNeeded() {
    const t = this.token;
    if (!t) throw new Error(`${this.label}에 연결하지 않았습니다.`);
    if (Date.now() < t.obtained_at + (t.expires_in ?? 3600) * 1000 - 120_000) return;
    if (!t.refresh_token) { this.logout(); throw new Error(`${this.label} 연결이 만료되었습니다. 다시 연결해 주세요.`); }
    const r = await getJson(t.token_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: t.resource }),
    });
    if (r.status >= 300) { this.logout(); throw new Error(`${this.label} 연결이 만료되었습니다. 다시 연결해 주세요.`); }
    store.set(this.tokenKey, { ...t, ...r.body, obtained_at: Date.now() });
    this.session = null;
  }

  async rpc(method, params, notify = false) {
    await this.refreshIfNeeded();
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${this.token.access_token}`, "MCP-Protocol-Version": "2025-06-18" };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if (!notify) msg.id = this.nextId++;
    const r = await pfetch(this.url, { method: "POST", headers, body: JSON.stringify(msg) });
    this.session = r.headers.get("mcp-session-id") ?? this.session;
    if (notify) return null;
    const text = await r.text();
    if (r.status === 401) { this.logout(); throw new Error(`${this.label} 연결이 만료되었습니다. 다시 연결해 주세요.`); }
    if (r.status >= 300) throw new Error(`${this.label} ${r.status}: ${text.slice(0, 300)}`);
    let reply;
    if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) { if (!line.startsWith("data:")) continue; try { const j = JSON.parse(line.slice(5)); if (j.id === msg.id) reply = j; } catch {} }
    } else reply = JSON.parse(text);
    if (!reply) throw new Error(`${this.label} 응답을 읽지 못했습니다.`);
    if (reply.error) throw new Error(`${this.label}: ${reply.error.message}`);
    return reply.result;
  }

  async ensureSession() {
    if (this.session) return;
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mudex-web", version: "0.3.0" } });
    await this.rpc("notifications/initialized", null, true);
  }

  async call(name, args = {}) {
    await this.ensureSession();
    let res;
    try { res = await this.rpc("tools/call", { name, arguments: args }); }
    catch (e) { if (!/session/i.test(e.message)) throw e; this.session = null; await this.ensureSession(); res = await this.rpc("tools/call", { name, arguments: args }); }
    const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (res.isError) throw new Error(`${this.label} ${name}: ${text.slice(0, 400)}`);
    if (res.structuredContent) return res.structuredContent;
    try { return JSON.parse(text); } catch { return { text }; }
  }

  async listTools() {
    await this.ensureSession();
    const tools = []; let cursor;
    for (let i = 0; i < 20; i++) { const r = await this.rpc("tools/list", cursor ? { cursor } : {}); tools.push(...(r.tools ?? [])); if (!r.nextCursor) break; cursor = r.nextCursor; }
    return tools;
  }
  async balance() { return this.call("balance"); }

  // 프로젝트 파일(Blob)을 올려 media_id를 받는다(무료)
  async upload(blob, name) {
    const ext = name.split(".").pop().toLowerCase();
    const type = ["mp4", "mov", "webm"].includes(ext) ? "video" : ["mp3", "wav", "m4a"].includes(ext) ? "audio" : "image";
    const up = await this.call("media_upload", { filename: name.replace(/[^\w.-]/g, "_") });
    const item = up.files?.[0] ?? up.uploads?.[0] ?? up;
    if (!item.upload_url || !item.media_id) throw new Error("업로드 주소를 받지 못했습니다.");
    const put = await fetch(item.upload_url, { method: "PUT", headers: item.content_type ? { "Content-Type": item.content_type } : {}, body: blob });
    if (!put.ok) throw new Error(`업로드 실패 ${put.status}`);
    await this.call("media_confirm", { type, media_id: item.media_id });
    return item.media_id;
  }
}
