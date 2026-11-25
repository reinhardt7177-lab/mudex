// 커넥터(원격 MCP) 관리, 웹판. 클로드의 "커스텀 커넥터 추가"와 같은 흐름.
//   진짜: OAuth 팝업 로그인 → tools/list → 도구 호출
//   연습: 네트워크 없이 같은 흐름(연습용 허용 창, 저장해 둔 도구 목록, 가짜 응답)
import { McpClient, HIGGSFIELD_MCP_URL } from "./mcp-client.js";

export const SAFE_TOOLS = ["balance", "models_explore", "list_workspaces", "get_preferences", "list_voices", "list_projects"];
// 화면에 보일 우리말 이름과 한 줄 설명(힉스필드 도구). 없는 도구는 영어 이름 그대로 보인다.
export const TOOL_KO = {
  balance: ["크레딧 보기", "남은 크레딧과 요금제를 봅니다."],
  list_workspaces: ["작업 공간 보기", "쓸 수 있는 작업 공간을 봅니다."],
  models_explore: ["모델 찾아보기", "쓸 수 있는 생성 모델과 설정을 봅니다."],
  media_upload: ["그림·파일 올리기", "내 힉스필드 계정에 그림이나 파일을 올립니다. 크레딧은 들지 않아요."],
  media_confirm: ["올린 파일 확인", "올린 파일이 잘 들어갔는지 확인합니다. 크레딧은 들지 않아요."],
  media_import_url: ["주소로 파일 가져오기", "인터넷 주소의 파일을 힉스필드로 가져옵니다."],
  estimate_video_cost: ["영상 비용 미리 보기", "영상을 만들면 크레딧이 얼마나 드는지 미리 봅니다. 크레딧은 들지 않아요."],
  estimate_image_cost: ["그림 비용 미리 보기", "그림을 만들면 크레딧이 얼마나 드는지 미리 봅니다. 크레딧은 들지 않아요."],
  estimate_audio_cost: ["소리 비용 미리 보기", "소리를 만들면 크레딧이 얼마나 드는지 미리 봅니다. 크레딧은 들지 않아요."],
  generate_video: ["영상 만들기", "힉스필드에서 영상을 만듭니다."],
  generate_video_batch: ["영상 여러 개 만들기", "힉스필드에서 영상을 여러 개 한꺼번에 만듭니다."],
  generate_image: ["그림 만들기", "힉스필드에서 그림을 만듭니다."],
  generate_image_batch: ["그림 여러 개 만들기", "힉스필드에서 그림을 여러 장 한꺼번에 만듭니다."],
  generate_audio: ["소리 만들기", "힉스필드에서 소리를 만듭니다."],
  upscale_image: ["그림 화질 높이기", "그림을 더 선명하고 크게 만듭니다."],
  upscale_video: ["영상 화질 높이기", "영상을 더 선명하고 크게 만듭니다."],
  remove_background: ["배경 지우기", "그림의 배경을 지웁니다."],
  job_status: ["진행 확인", "만드는 중인 작업이 얼마나 됐는지 봅니다."],
  jobs_wait: ["다 될 때까지 기다리기", "만드는 중인 작업이 끝날 때까지 기다립니다."],
  job_display: ["결과 보기", "다 만든 결과를 봅니다."],
  show_generations: ["만든 것 보기", "지금까지 만든 그림·영상을 봅니다."],
};
export const toolKo = (name) => TOOL_KO[name]?.[0] ?? name;
const KEY = "mudex.connectors";
const isHiggsfield = (url) => { try { return new URL(url).host === new URL(HIGGSFIELD_MCP_URL).host; } catch { return false; } };
let PRACTICE = null;
const practiceTools = async () => (PRACTICE ??= (await (await fetch("/practice_tools.json")).json()).tools);

export class Connectors {
  constructor(hf, onChange) {
    this.hf = hf; this.onChange = onChange;
    this.list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    this.clients = new Map(); this.toolCache = new Map();
    window.addEventListener("message", (e) => {
      if (e.origin !== location.origin || e.data?.type !== "mudex-practice") return;
      this.practiceApprove(e.data.id);
    });
  }
  save() { localStorage.setItem(KEY, JSON.stringify(this.list)); }
  get(id) { const c = this.list.find((x) => x.id === id); if (!c) throw new Error("없는 커넥터입니다."); return c; }
  client(c) {
    if (c.practice) return null;
    if (isHiggsfield(c.url)) return this.hf;
    if (!this.clients.has(c.id)) this.clients.set(c.id, new McpClient({ url: c.url, key: `c_${c.id}`, label: c.name }));
    return this.clients.get(c.id);
  }
  status(c) {
    if (c.practice) return { connected: !!c.practice_connected, logging_in: false };
    const cl = this.client(c);
    return { connected: cl.loggedIn, logging_in: !!cl.pendingLogin };
  }
  view() { return this.list.map((c) => ({ ...c, ...this.status(c), tools_count: this.toolCache.get(c.id)?.length ?? (c.practice && c.practice_connected ? 185 : null) })); }

  add({ name, url, practice }) {
    name = String(name ?? "").trim().slice(0, 40); url = String(url ?? "").trim();
    if (!name) throw new Error("이름을 넣어 주세요.");
    let u; try { u = new URL(url); } catch { throw new Error("주소가 올바르지 않습니다. https://로 시작하는 MCP 서버 주소를 넣어 주세요."); }
    if (u.protocol !== "https:" && !practice) throw new Error("https:// 주소만 연결할 수 있습니다.");
    const c = { id: Math.random().toString(16).slice(2, 10), name, url: u.toString(), practice: !!practice, added_at: Date.now() };
    this.list.push(c); this.save();
    return c;
  }
  remove(id) { const c = this.get(id); if (!c.practice) this.client(c).logout(); this.list = this.list.filter((x) => x.id !== id); this.toolCache.delete(id); this.save(); }

  async connect(id) {
    const c = this.get(id);
    if (c.practice) {
      const url = `/practice?c=${encodeURIComponent(id)}&n=${encodeURIComponent(c.name)}&u=${encodeURIComponent(c.url)}`;
      const pre = window.__mudexPopup; window.__mudexPopup = null;
      let w = pre && !pre.closed ? pre : null;
      if (w) w.location.href = url; else w = window.open(url, "mudex-practice", "width=520,height=720");
      return { url, practice: true, blocked: !w };
    }
    const cl = this.client(c);
    const login = await cl.startLogin();
    login.done.then(() => this.onChange({ id, ok: true }), (e) => this.onChange({ id, ok: false, error: e.message }));
    return { url: login.url, blocked: login.blocked };
  }
  practiceApprove(id) {
    const c = this.list.find((x) => x.id === id);
    if (!c) return;
    c.practice_connected = true; c.connected_at = Date.now(); this.save();
    this.onChange({ id, ok: true });
  }
  disconnect(id) {
    const c = this.get(id);
    if (c.practice) { c.practice_connected = false; this.save(); } else this.client(c).logout();
    this.toolCache.delete(id);
  }
  async tools(id) {
    const c = this.get(id);
    if (c.practice) { if (!c.practice_connected) throw new Error("먼저 연결해 주세요."); return practiceTools(); }
    const cl = this.client(c);
    if (!cl.loggedIn) throw new Error("먼저 연결해 주세요.");
    if (!this.toolCache.has(id)) this.toolCache.set(id, (await cl.listTools()).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema })));
    return this.toolCache.get(id);
  }
  connected() { return this.list.filter((c) => this.status(c).connected); }
  find(ref) {
    const r = String(ref ?? "").toLowerCase();
    const live = this.connected();
    const c = live.find((x) => x.id === ref || x.name.toLowerCase() === r) ?? (live.length === 1 ? live[0] : null);
    if (!c) throw new Error(`연결된 커넥터 '${ref ?? ""}'가 없습니다. 연결된 것: ${live.map((x) => x.name).join(", ") || "없음"}`);
    return c;
  }
  async callAny(id, name, args = {}) {
    const c = this.get(id);
    if (c.practice) {
      if (SAFE_TOOLS.includes(name)) return practiceAnswer(name, args);
      return { practice: true, note: "연습 모드 커넥터라 실제로 실행하지 않았습니다. 진짜 커넥터를 연결하면 이 자리에서 실행됩니다.", tool: name };
    }
    return this.client(c).call(name, args);
  }
  async call(id, name, args = {}) {
    if (!SAFE_TOOLS.includes(name)) throw new Error(`화면에서는 크레딧을 쓰지 않는 조회 도구만 눌러 볼 수 있습니다: ${SAFE_TOOLS.join(", ")}`);
    const c = this.get(id);
    if (c.practice && !c.practice_connected) throw new Error("먼저 연결해 주세요.");
    if (!c.practice && !this.client(c).loggedIn) throw new Error("먼저 연결해 주세요.");
    return this.callAny(id, name, args);
  }
}

function practiceAnswer(name, args) {
  switch (name) {
    case "balance": return { credits: 200, subscription_plan_type: "starter (연습 모드)" };
    case "models_explore": return { items: [
      { id: "kling3_0", name: "Kling v3.0", output_type: "video", description: "Multi-shot, audio sync, motion transfer" },
      { id: "kling2_6", name: "Kling 2.6 Video", output_type: "video", description: "Cinematic motion, advanced physics" },
      { id: "kling3_0_turbo", name: "Kling 3.0 Turbo", output_type: "video", description: "Fast text-to-video and single start-frame animation" },
    ], note: "연습 모드: 2026-11-03에 실제로 받은 목록 일부" };
    case "list_workspaces": return { workspaces: [{ id: "practice", name: "연수생 작업공간 (연습)" }] };
    case "get_preferences": return { auto_create_project: false, note: "연습 모드" };
    default: return { note: "연습 모드 응답", tool: name, args };
  }
}
