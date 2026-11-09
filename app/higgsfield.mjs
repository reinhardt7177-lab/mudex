// 원격 MCP 클라이언트: OAuth 2.1(동적 등록 + PKCE + 127.0.0.1 콜백) 로그인, 토큰 갱신, 도구 호출.
// 기본은 힉스필드. 커넥터 화면에서 다른 주소도 붙일 수 있다.
// 토큰은 dataDir/<key>_token.json에만 저장하고 화면·로그에 찍지 않는다.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

export function openBrowser(url) {
  if (process.env.MUDEX_PUBLIC_URL || process.env.MUDEX_NO_OPEN) return;
  // cmd의 start는 &에서 끊기므로 rundll32로 연다
  spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

export class McpClient {
  constructor(dataDir, { url = MCP_URL, key = "hf", label = "힉스필드", publicBase = process.env.MUDEX_PUBLIC_URL } = {}) {
    this.dataDir = dataDir;
    this.url = url;
    this.label = label;
    this.publicBase = publicBase;
    this.redirect = publicBase ? `${publicBase}/oauth/callback/${encodeURIComponent(key)}` : REDIRECT;
    fs.mkdirSync(dataDir, { recursive: true });
    this.tokenFile = path.join(dataDir, `${key}_token.json`);
    this.clientFile = path.join(dataDir, `${key}_client.json`);
    this.token = fs.existsSync(this.tokenFile) ? JSON.parse(fs.readFileSync(this.tokenFile, "utf8")) : null;
    this.session = null;
    this.nextId = 1;
    this.pendingLogin = null;
    this.authIssue = null;
    this.authEpoch = 0;
  }

  get loggedIn() { return !!this.token; }

  saveToken(t, {refresh=false}={}) {
    if(!refresh)this.authEpoch++;
    this.token = t;
    fs.writeFileSync(this.tokenFile, JSON.stringify(t));
  }

  logout() {
    this.authEpoch++;
    this.token = null;
    this.session = null;
    this.authIssue = null;
    try { fs.unlinkSync(this.tokenFile); } catch {}
  }

  // 보호 자원 메타데이터 → 인증 서버 메타데이터(RFC 9728, 8414). 없으면 서버 주소의 origin을 인증 서버로 본다.
  async discover() {
    const u = new URL(this.url);
    let pr = await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`).catch(() => null);
    if (!pr || pr.status >= 300 || typeof pr.body !== "object") pr = await getJson(`${u.origin}/.well-known/oauth-protected-resource`).catch(() => null);
    const prm = pr && pr.status < 300 && typeof pr.body === "object" ? pr.body : {};
    const asBase = (prm.authorization_servers?.[0] ?? u.origin).replace(/\/$/, "");
    let as = await getJson(`${asBase}/.well-known/oauth-authorization-server`).catch(() => null);
    if (!as || as.status >= 300 || typeof as.body !== "object") as = await getJson(`${asBase}/.well-known/openid-configuration`).catch(() => null);
    if (!as || as.status >= 300 || !as.body.authorization_endpoint) throw new Error(`${this.label}: 로그인 서버 정보를 찾지 못했습니다. 주소가 맞는지 확인해 주세요.`);
    return { resource: prm.resource ?? this.url, scopes: prm.scopes_supported ?? as.body.scopes_supported ?? [], as: as.body };
  }

  async register(as) {
    if (fs.existsSync(this.clientFile)) {
      const saved = JSON.parse(fs.readFileSync(this.clientFile, "utf8"));
      if (saved.mudex_redirect === this.redirect || (!this.publicBase && !saved.mudex_redirect)) return saved;
    }
    if (!as.registration_endpoint) throw new Error(`${this.label}: 이 서버는 자동 등록(동적 클라이언트 등록)을 지원하지 않습니다.`);
    const r = await getJson(as.registration_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Mudex (무덱스)",
        redirect_uris: [this.redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (r.status >= 300) throw new Error(`${this.label}가 클라이언트 등록을 거절했습니다: ` + JSON.stringify(r.body).slice(0, 200));
    fs.writeFileSync(this.clientFile, JSON.stringify({ ...r.body, mudex_redirect: this.redirect }));
    return r.body;
  }

  // 로그인 시작: 브라우저를 열고, 콜백을 받으면 토큰을 저장한다. 15분 기다린다.
  async startLogin() {
    if (this.pendingLogin) return this.pendingLogin.url;
    const { resource, scopes, as } = await this.discover();
    const client = await this.register(as);
    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(16));
    const url = new URL(as.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: this.redirect,
      scope: scopes.join(" "),
      state,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource,
    }).toString();

    let resolveDone, rejectDone, server;
    const done = new Promise((resolve, reject) => { resolveDone=resolve; rejectDone=reject; });
    done.catch(() => {});
    const timer = setTimeout(() => finish(new Error("15분 안에 로그인이 끝나지 않았습니다.")), 15 * 60 * 1000);
    timer.unref?.();
    const finish = (error) => {
      clearTimeout(timer); server?.close(); this.pendingLogin=null;
      error ? rejectDone(error) : resolveDone();
    };
    this.pendingLogin = { url:url.toString(), done, state, verifier, resource, as, client, finish };
    if (!this.publicBase) {
      server = http.createServer(async (req,res) => {
        const u = new URL(req.url, REDIRECT);
        if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
        try {
          await this.completeLogin(u);
          res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
          res.end(page('연결 완료', '이 창을 닫고 무덱스로 돌아가세요.'));
        } catch {
          res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
          res.end(page('로그인하지 못했습니다', '무덱스로 돌아가 다시 연결해 주세요.'));
        }
      });
      server.on('error',e=>finish(new Error(`로그인 콜백 포트 ${PORT}를 열 수 없습니다: ${e.message}`)));
      server.listen(PORT,'127.0.0.1');
      openBrowser(url.toString());
    }
    return url.toString();
  }

  async completeLogin(url) {
    const p=this.pendingLogin;
    if (!p || url.searchParams.get('state') !== p.state) throw new Error('OAuth state 상태가 일치하지 않습니다.');
    try {
      const code=url.searchParams.get('code');
      if (!code) throw new Error('로그인이 취소되었거나 승인 코드가 없습니다.');
      const tok=await getJson(p.as.token_endpoint, {
        method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.redirect,client_id:p.client.client_id,code_verifier:p.verifier,resource:p.resource}),
      });
      if (tok.status >= 300 || !tok.body.access_token) throw new Error(`토큰 교환 실패 ${tok.status}`);
      this.saveToken({...tok.body, obtained_at:Date.now(),token_endpoint:p.as.token_endpoint,client_id:p.client.client_id,resource:p.resource});
      this.session=null;this.authIssue=null;
      await this.verifyConnection();
      p.finish();
    } catch(e) {p.finish(e);throw e;}
  }

  async refreshIfNeeded() {
    const t = this.token;
    if (!t) throw new Error(`${this.label}에 로그인하지 않았습니다.`);
    if (Date.now() < t.obtained_at + (t.expires_in ?? 3600) * 1000 - 120_000) return;
    if (!t.refresh_token) { this.logout(); throw new Error(`${this.label} 로그인이 만료되었습니다. 다시 연결해 주세요.`); }
    const r = await getJson(t.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, resource: t.resource }),
    });
    if (r.status >= 300) { this.logout(); throw new Error(`${this.label} 로그인이 만료되었습니다. 다시 연결해 주세요.`); }
    this.saveToken({ ...t, ...r.body, obtained_at: Date.now() },{refresh:true});
    this.session = null;
  }

  async rpc(method, params, notify = false) {
    await this.refreshIfNeeded();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.token.access_token}`,
      "MCP-Protocol-Version": "2025-06-18",
    };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const msg = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if (!notify) msg.id = this.nextId++;
    const r = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(msg) });
    this.session = r.headers.get("mcp-session-id") ?? this.session;
    if (notify) return null;
    const text = await r.text();
    if (r.status === 401) { this.logout(); throw new Error(`${this.label} 로그인이 만료되었습니다. 다시 연결해 주세요.`); }
    if (r.status >= 300) throw new Error(`${this.label} ${r.status}: ${text.slice(0, 300)}`);
    let reply;
    if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try { const j = JSON.parse(line.slice(5)); if (j.id === msg.id) reply = j; } catch {}
      }
    } else reply = JSON.parse(text);
    if (!reply) throw new Error(`${this.label} 응답을 읽지 못했습니다.`);
    if (reply.error) throw new Error(`${this.label}: ${reply.error.message}`);
    return reply.result;
  }

  async ensureSession() {
    if (this.session) return;
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mudex", version: "0.2.0" } });
    await this.rpc("notifications/initialized", null, true);
  }

  async verifyConnection() {}

  // 도구 호출. 결과는 structuredContent가 있으면 그것, 없으면 텍스트를 JSON으로 읽어 본다.
  async call(name, args = {}) {
    await this.ensureSession();
    let res;
    try { res = await this.rpc("tools/call", { name, arguments: args }); }
    catch (e) {
      if (/session/i.test(e.message)) this.session=null;
      // The server may have completed a paid/destructive call before the connection failed.
      throw e;
    }
    const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const details=res.structuredContent??(()=>{try{return JSON.parse(text);}catch{return null;}})();
    if(this.url===MCP_URL && (res.isError||details?.error) && /Your Higgsfield session has expired|FNF API .*?\(401\)/i.test(res.isError?text+' '+JSON.stringify(details):JSON.stringify(details.error))) {
      const message='힉스필드가 인증을 거절했습니다. 다시 로그인한 직후에도 반복된다면 힉스필드 측 인증 처리 문제일 수 있습니다. 영상 파일을 직접 올려 편집하거나 잠시 뒤 연결 확인을 눌러 주세요.';
      this.authIssue={code:'higgsfield_session_rejected',message,request_id:details?.request_id??null};
      throw Object.assign(new Error(message),this.authIssue);
    }
    if (res.isError) throw new Error(`${this.label} ${name}: ${text.slice(0, 400)}`);
    if(details?.error)throw new Error(`${this.label} ${name}: ${typeof details.error==='string'?details.error:JSON.stringify(details.error)}`);
    this.authIssue=null;
    if (res.structuredContent) return res.structuredContent;
    try { return JSON.parse(text); } catch { return { text }; }
  }

  async listTools() {
    await this.ensureSession();
    const tools = [];
    let cursor;
    for (let i = 0; i < 20; i++) {
      const r = await this.rpc("tools/list", cursor ? { cursor } : {});
      tools.push(...(r.tools ?? []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return tools;
  }

  async balance() { return this.call("balance"); }

  // 로컬 파일을 올려 media_id를 받는다(무료).
  async upload(file) {
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    const type = [".mp4", ".mov", ".webm"].includes(ext) ? "video" : [".mp3", ".wav", ".m4a"].includes(ext) ? "audio" : "image";
    const contentType = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" }[ext];
    const up = await this.call("media_upload", { filename: name.replace(/[^\w.-]/g, "_") });
    const item = up.files?.[0] ?? up.uploads?.[0] ?? up;
    const uploadUrl = item.upload_url ?? item.url;
    const mediaId = item.media_id ?? item.id;
    if (!uploadUrl || !mediaId) throw new Error("힉스필드 업로드 주소를 받지 못했습니다: " + JSON.stringify(up).slice(0, 300));
    const put = await fetch(uploadUrl, { method: "PUT", headers: contentType ? { "Content-Type": contentType } : {}, body: fs.readFileSync(file) });
    if (!put.ok) throw new Error(`힉스필드 업로드 실패 ${put.status}`);
    await this.call("media_confirm", { type, media_id: mediaId });
    return mediaId;
  }
}

function page(title, msg) {
  return `<!doctype html><meta charset="utf-8"><title>무덱스</title><body style="background:#0a0b0e;color:#ecebe6;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="width:56px;height:56px;border-radius:14px;background:#46e0b5;margin:0 auto 18px"></div><h2>${title}</h2><p style="color:#8c8f99">${msg}</p></div>`;
}

// 무덱스의 생성 도구가 쓰는 힉스필드 연결
export class Higgsfield extends McpClient {
  constructor(dataDir) { super(dataDir, { url: MCP_URL, key: "hf", label: "힉스필드" }); }
  async verifyConnection() {await this.balance();}
}
export const HIGGSFIELD_MCP_URL = MCP_URL;
