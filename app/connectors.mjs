// 커넥터(원격 MCP 서버) 관리. 클로드의 "커스텀 커넥터 추가"와 같은 흐름을 연수생이 직접 해 본다.
//   진짜: OAuth 로그인 → tools/list → 도구 호출
//   연습: 네트워크 없이 같은 화면 흐름(가짜 로그인 창, 저장해 둔 도구 목록, 가짜 응답)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpClient, HIGGSFIELD_MCP_URL, openBrowser } from "./higgsfield.mjs";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRACTICE = JSON.parse(fs.readFileSync(path.join(APP_DIR, "practice_tools.json"), "utf8"));

// 화면에서 눌러 볼 수 있는 도구. 크레딧을 쓰지 않는 조회만 허락한다.
export const SAFE_TOOLS = ["balance", "models_explore", "list_workspaces", "get_preferences", "list_voices", "list_projects"];

const KNOWN_READS = new Set([...SAFE_TOOLS, "job_status", "media_get", "visual_effects_samples", "visual_effects_history", "ai_influencer_character_sheet_presets"]);
const words = (value) => String(value).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const EFFECT_WORDS = new Set(["generate", "generation", "create", "delete", "remove", "publish", "post", "send", "submit", "upload", "confirm", "update", "edit", "modify", "write", "set", "save", "buy", "purchase", "pay", "charge", "spend", "consume", "debit", "execute", "exec", "run", "cancel", "retry", "regenerate", "rerun", "start", "stop", "connect", "disconnect", "install", "uninstall", "transfer", "move", "copy", "download", "export", "import", "dispatch", "invoke", "enable", "disable", "approve", "grant", "revoke", "like", "unlike", "report", "archive", "unarchive", "rename", "restore", "patch", "attach", "detach", "link", "unlink", "duplicate", "reorder", "schedule", "unschedule", "sync", "synchronize", "clear", "empty", "reset", "replace", "insert", "upsert", "append", "prepend", "merge", "commit", "apply", "push", "register", "unregister", "login", "logout", "authorize", "join", "leave", "invite", "favorite", "unfavorite", "bookmark", "unbookmark", "subscribe", "unsubscribe"]);
const CONTROL_KEYS = new Set(["action", "operation", "method", "command", "event", "mode", "task", "tool", "tool_name", "function", "handler", "verb", "op"]);
const isEffect = (value) => words(value).some((word) => EFFECT_WORDS.has(word));
const isReadName = (value) => /^(get|read|list|search|find|fetch|browse|lookup|describe|inspect|check)(_|$)/.test(words(value).join("_")) || /(^|_)(list|search|status)$/.test(words(value).join("_"));
function controlArguments(value, controls = []) {
  if (!value || typeof value !== "object") return { controls };
  for (const [key, item] of Object.entries(value)) {
    const keyWords = words(key);
    if (CONTROL_KEYS.has(keyWords.join("_"))) {
      if (typeof item !== "string" || !isReadName(item) || isEffect(item)) return { reason: `작업 인자 '${key}'가 조회 전용임을 확인할 수 없습니다.` };
      controls.push(item);
    } else if (isEffect(key) && item !== false && item !== null && item !== undefined) {
      return { reason: `변경 또는 실행 인자 '${key}'를 확인해야 합니다.` };
    }
    if (item && typeof item === "object") {
      const nested = controlArguments(item, controls);
      if (nested.reason) return nested;
    }
  }
  return { controls };
}
function hasControlSchema(schema) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.properties && Object.keys(schema.properties).some((key) => CONTROL_KEYS.has(words(key).join("_")))) return true;
  return Object.values(schema).some((value) => value && typeof value === "object" && (Array.isArray(value) ? value.some(hasControlSchema) : hasControlSchema(value)));
}

// Hints describe remote tools, but cannot grant permission for effects or multiplexed actions.
export function mcpPolicy(tool, args = {}) {
  if (isEffect(tool.name) || tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint === false) return { approval_required: true, effects: ["remote_effect"], reason: "크레딧 사용·변경·공개 등 실행 결과를 확인하고 승인해야 합니다." };
  const checked = controlArguments(args);
  if (checked.reason) return { approval_required: true, effects: ["remote_effect"], reason: checked.reason };
  if (!tool.inputSchema || hasControlSchema(tool.inputSchema) || checked.controls.length) return { approval_required: true, effects: ["unknown_action"], reason: "여러 작업을 수행하거나 입력 계약이 확인되지 않은 도구입니다. 구체적인 작업을 확인해야 합니다." };
  if (KNOWN_READS.has(tool.name) || isReadName(tool.name)) {
    return { approval_required: false, effects: [], reason: "조회 도구입니다." };
  }
  return { approval_required: true, effects: ["unknown_effect"], reason: "조회 전용인지 확인되지 않은 도구입니다." };
}

// Canonical JSON binds approval to every argument, including nested values and array order.
function canonical(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error("도구 인자는 JSON 객체여야 합니다.");
  seen.add(value);
  const result = Array.isArray(value) ? `[${Array.from(value, (item) => canonical(item, seen)).join(",")}]` : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(",")}}`;
  seen.delete(value);
  return result;
}
function snapshotArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("도구 인자는 JSON 객체여야 합니다.");
  return JSON.parse(canonical(args));
}

const isHiggsfield = (url) => { try { return new URL(url).host === new URL(HIGGSFIELD_MCP_URL).host; } catch { return false; } };

export class Connectors {
  #approvals = new Map();
  // hf: 생성 도구가 쓰는 힉스필드 클라이언트(진짜 힉스필드 커넥터는 이것과 같은 연결을 쓴다)
  constructor(dataDir, hf, onChange) {
    this.dataDir = dataDir;
    this.hf = hf;
    this.onChange = onChange;
    this.file = path.join(dataDir, "connectors.json");
    this.list = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : [];
    this.clients = new Map();
    this.toolCache = new Map();
    // 예전에 힉스필드에 로그인해 둔 상태면 목록에도 보이게 한다
    if (hf.loggedIn && !this.list.some((c) => !c.practice && isHiggsfield(c.url))) {
      this.list.push({ id: "higgsfield", name: "Higgsfield", url: HIGGSFIELD_MCP_URL, practice: false, added_at: Date.now() });
      this.save();
    }
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2)); }
  get(id) { const c = this.list.find((x) => x.id === id); if (!c) throw new Error("없는 커넥터입니다."); return c; }

  client(c) {
    if (c.practice) return null;
    if (isHiggsfield(c.url)) return this.hf;
    if (!this.clients.has(c.id)) this.clients.set(c.id, new McpClient(this.dataDir, { url: c.url, key: `mcp_${c.id}`, label: c.name }));
    return this.clients.get(c.id);
  }

  status(c) {
    if (c.practice) return { connected: !!c.practice_connected, logging_in: false };
    const cl = this.client(c);
    return { connected: cl.loggedIn, logging_in: !!cl.pendingLogin };
  }

  view() {
    return this.list.map((c) => ({ ...c, ...this.status(c), tools_count: this.toolCache.get(c.id)?.length ?? (c.practice && c.practice_connected ? PRACTICE.tools.length : null) }));
  }

  add({ name, url, practice }) {
    name = String(name ?? "").trim().slice(0, 40);
    url = String(url ?? "").trim();
    if (!name) throw new Error("이름을 넣어 주세요.");
    let u;
    try { u = new URL(url); } catch { throw new Error("주소가 올바르지 않습니다. https://로 시작하는 MCP 서버 주소를 넣어 주세요."); }
    if (u.protocol !== "https:" && !practice) throw new Error("https:// 주소만 연결할 수 있습니다.");
    const c = { id: crypto.randomBytes(4).toString("hex"), name, url: u.toString(), practice: !!practice, added_at: Date.now() };
    this.list.push(c);
    this.save();
    return c;
  }

  remove(id) {
    const c = this.get(id);
    if (!c.practice) this.client(c).logout();
    this.list = this.list.filter((x) => x.id !== id);
    this.toolCache.delete(id);
    this.clearApprovals(id);
    this.save();
  }

  // 연결: 진짜면 OAuth 창을, 연습이면 무덱스가 띄우는 연습용 로그인 창을 연다
  async connect(id, localBase) {
    const c = this.get(id);
    if (c.practice) {
      const url = `${localBase}/practice/authorize?c=${encodeURIComponent(id)}`;
      openBrowser(url);
      return { url, practice: true };
    }
    const cl = this.client(c);
    const url = await cl.startLogin();
    cl.pendingLogin?.done.then(() => this.onChange({ id, ok: true }), (e) => this.onChange({ id, ok: false, error: e.message }));
    return { url };
  }

  async completeLogin(key, url) {
    const client = key === 'hf' ? this.hf : this.client(this.get(key.replace(/^mcp_/, '')));
    return client.completeLogin(url);
  }

  practiceApprove(id) {
    const c = this.get(id);
    c.practice_connected = true;
    c.connected_at = Date.now();
    this.save();
    this.onChange({ id, ok: true });
  }

  disconnect(id) {
    const c = this.get(id);
    if (c.practice) { c.practice_connected = false; this.save(); }
    else this.client(c).logout();
    this.toolCache.delete(id);
    this.clearApprovals(id);
  }

  async tools(id) {
    const c = this.get(id);
    if (c.practice) {
      if (!c.practice_connected) throw new Error("먼저 연결해 주세요.");
      return PRACTICE.tools;
    }
    const cl = this.client(c);
    if (!cl.loggedIn) throw new Error("먼저 연결해 주세요.");
    if (!this.toolCache.has(id)) this.toolCache.set(id, (await cl.listTools()).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) })));
    return structuredClone(this.toolCache.get(id));
  }

  clearApprovals(id) {
    for (const [token, grant] of this.#approvals) if (grant.id === id || grant.expires <= Date.now()) this.#approvals.delete(token);
  }

  async checkedCall(id, name, args) {
    const c = this.get(id);
    const argumentsCopy = snapshotArguments(args);
    const tool = (await this.tools(id)).find((tool) => tool.name === name);
    if (!tool) throw new Error(`커넥터에 없는 도구입니다: ${name}`);
    if (!this.status(c).connected) throw new Error("먼저 연결해 주세요.");
    return { c, tool, argumentsCopy, policy: mcpPolicy(tool, argumentsCopy) };
  }

  async prepareCall(id, name, args = {}) {
    const { c, tool, argumentsCopy, policy } = await this.checkedCall(id, name, args);
    this.clearApprovals();
    const proposal = { ...policy, connector: { id: c.id, name: c.name, practice: c.practice }, tool: tool.name, arguments: argumentsCopy };
    if (policy.approval_required) {
      const token = crypto.randomBytes(32).toString("base64url");
      this.#approvals.set(token, { id, name, target: canonical({ url: c.url, name: c.name, practice: c.practice }), arguments: canonical(argumentsCopy), expires: Date.now() + 5 * 60_000 });
      proposal.approval_token = token;
    }
    return proposal;
  }

  async call(id, name, args = {}, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || (options.approval_token !== undefined && typeof options.approval_token !== "string")) throw new Error("유효한 일회용 승인(approval) 토큰이 필요합니다.");
    const { c, argumentsCopy, policy } = await this.checkedCall(id, name, args);
    const token = options.approval_token;
    if (policy.approval_required || token !== undefined) {
      const grant = this.#approvals.get(token);
      this.#approvals.delete(token);
      if (!grant || grant.expires <= Date.now() || grant.id !== id || grant.name !== name || grant.target !== canonical({ url: c.url, name: c.name, practice: c.practice }) || grant.arguments !== canonical(argumentsCopy)) throw new Error("이 도구와 인자에 대한 일회용 승인(approval)이 필요하거나 만료되었습니다.");
    }
    return c.practice ? practiceAnswer(name, argumentsCopy) : this.client(c).call(name, argumentsCopy);
  }

  async search(query = "", limit = 8) {
    if (typeof query !== "string") throw new Error("검색어는 문자열이어야 합니다.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("검색 개수는 1~50이어야 합니다.");
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const connectors = this.view().filter((c) => c.connected).map(({ id, name, practice }) => ({ id, name, practice }));
    const matches = [];
    const errors = [];
    for (const connector of connectors) {
      try {
        for (const tool of await this.tools(connector.id)) {
          const haystack = `${connector.id} ${connector.name} ${tool.name} ${tool.description ?? ""}`.toLowerCase();
          if (terms.every((term) => haystack.includes(term))) matches.push({ connector, ...tool, policy: mcpPolicy(tool) });
        }
      } catch (e) { errors.push({ connector, error: e.message }); }
    }
    return { connectors, tools: matches.slice(0, limit), total: matches.length, limit, ...(errors.length ? { errors } : {}) };
  }
}

// 연습 모드 응답: 실제 응답과 같은 모양, 값은 연습용
function practiceAnswer(name, args) {
  switch (name) {
    case "balance": return { credits: 200, subscription_plan_type: "starter (연습 모드)" };
    case "models_explore":
      return { items: [
        { id: "kling3_0", name: "Kling v3.0", output_type: "video", description: "Multi-shot, audio sync, motion transfer" },
        { id: "kling2_6", name: "Kling 2.6 Video", output_type: "video", description: "Cinematic motion, advanced physics" },
        { id: "kling3_0_turbo", name: "Kling 3.0 Turbo", output_type: "video", description: "Fast text-to-video and single start-frame animation" },
      ], note: "연습 모드: 2026-11-03에 실제로 받은 목록 일부" };
    case "list_workspaces": return { workspaces: [{ id: "practice", name: "연수생 작업공간 (연습)" }] };
    case "get_preferences": return { auto_create_project: false, note: "연습 모드" };
    default: return { note: "연습 모드 응답", tool: name, args };
  }
}

export function practiceLoginPage(c, done = false) {
  const body = done
    ? `<h2>연결 완료</h2><p>연습 모드라 실제로 로그인한 것은 아닙니다.<br>이 창을 닫고 무덱스로 돌아가세요.</p>`
    : `<div class="warn">연습 모드입니다. 실제 계정에 로그인하지 않고, 아무 정보도 보내지 않습니다.</div>
       <h2>${escapeHtml(c.name)}에 무덱스를 연결할까요?</h2>
       <p class="url">${escapeHtml(c.url)}</p>
       <div class="perm"><b>무덱스가 할 수 있게 되는 일</b><ul><li>내 계정 잔액과 요금제 보기</li><li>내 계정으로 이미지·영상 만들기(크레딧 사용)</li><li>만든 결과 내려받기</li></ul></div>
       <form method="post" action="/practice/approve?c=${encodeURIComponent(c.id)}"><button class="ok">허용</button><button class="no" type="button" onclick="window.close()">취소</button></form>
       <p class="small">진짜 연결에서는 이 자리에 서비스의 로그인 화면이 나오고, 로그인한 다음 같은 "허용" 단계를 거칩니다.</p>`;
  return `<!doctype html><meta charset="utf-8"><title>연습용 연결 · 무덱스</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0e;color:#ecebe6;font-family:"Pretendard","Malgun Gothic",system-ui}
.box{width:min(440px,92vw);background:#131419;border:1px solid #2e313b;border-radius:16px;padding:26px;display:grid;gap:12px}
.warn{background:rgba(244,185,66,.12);border:1px solid rgba(244,185,66,.4);color:#f4b942;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600}
h2{margin:6px 0 0;font-size:19px}.url{font-family:monospace;font-size:12px;color:#8c8f99;margin:0}
.perm{background:#0a0b0e;border:1px solid #24262e;border-radius:10px;padding:12px 14px;font-size:13.5px}.perm ul{margin:8px 0 0;padding-left:18px;color:#b4b5bc}
form{display:flex;gap:8px;margin-top:4px}button{font:inherit;font-weight:700;padding:10px 18px;border-radius:9px;border:1px solid #2e313b;background:#1c1e25;color:#ecebe6;cursor:pointer}
.ok{background:#46e0b5;color:#04261c;border-color:transparent}.small{font-size:12px;color:#7c7f8a;margin:0}
.badge{width:52px;height:52px;border-radius:13px;background:#46e0b5}</style>
<div class="box"><div class="badge"></div>${body}</div>`;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
