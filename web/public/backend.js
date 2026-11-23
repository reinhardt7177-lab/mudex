// 웹판 백엔드: PC판 로컬 서버(app/server.mjs)가 하던 일을 브라우저 안에서 한다.
// 화면(app.js)은 그대로 /api/… 를 부르고, 여기서 그 요청을 받아 처리한다(fetch·EventSource를 가로챈다).
// 프로젝트 파일은 OPFS, 설정·토큰은 localStorage.
import { Workspace, listProjects, kindOf, loadLocals, pickLocalFolder, grantLocal, localPermission, locals, canPickFolder, projectsDir, forgetLocal } from "./opfs.js";
await loadLocals();
import { McpClient } from "./mcp-client.js";
import { Connectors, SAFE_TOOLS } from "./connectors.js";
import { runAgent, relayStatus, DEFAULT_RELAY, DEFAULT_MODEL, DEFAULT_EFFORT } from "./agent.js";

const SKEY = "mudex.settings";
const settings = JSON.parse(localStorage.getItem(SKEY) ?? "{}");
const saveSettings = () => localStorage.setItem(SKEY, JSON.stringify(settings));
const relay = () => settings.relay ?? DEFAULT_RELAY;

// ---------- 실시간 이벤트(EventSource 대신) ----------
const subs = new Map(); // 키("*" 또는 작업 id) → Set<fn>
function publish(key, ev) { for (const fn of subs.get(key) ?? []) fn(ev); }
class LocalEventSource {
  constructor(url) {
    const m = url.match(/\/api\/jobs\/([^/]+)\/events/);
    this.key = m ? decodeURIComponent(m[1]) : "*";
    this.onmessage = null;
    this.fn = (ev) => this.onmessage?.({ data: JSON.stringify(ev) });
    if (!subs.has(this.key)) subs.set(this.key, new Set());
    subs.get(this.key).add(this.fn);
  }
  close() { subs.get(this.key)?.delete(this.fn); }
}

const hf = new McpClient();
const connectors = new Connectors(hf, (ev) => publish("*", { type: "connectors_changed", ...ev }));

// ---------- 프로젝트 ----------
const ws = (id) => new Workspace(id);
async function readJson(w, rel, dflt) { try { return JSON.parse(await w.readText(rel)); } catch { return dflt; } }
async function touchJob(id, patch = {}) {
  const w = ws(id);
  const meta = { ...(await readJson(w, ".mudex/meta.json", {})), ...patch, updated: Date.now() };
  await w.write(".mudex/meta.json", JSON.stringify(meta));
  return meta;
}
async function listJobs() {
  const out = [];
  for (const id of await listProjects()) {
    const local = locals.has(id);
    const perm = local ? await localPermission(id) : "granted";
    const meta = perm === "granted" ? await readJson(ws(id), ".mudex/meta.json", {}) : {};
    out.push({ id, name: meta.name ?? id, updated: meta.updated ?? (local ? 1 : 0), thumb: meta.thumb ?? null, local, needs_permission: perm !== "granted" });
  }
  return out.sort((a, b) => b.updated - a.updated);
}
async function readEvents(id) {
  try { return (await ws(id).readText(".mudex/events.jsonl")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
// OPFS 파일에는 '이어 쓰기'가 없어서 이벤트는 메모리에 모아 두고 잠깐씩 통째로 쓴다
const evCache = new Map();
const flushT = new Map();
async function emit(id, ev) {
  const e = { ...ev, at: Date.now() };
  if (!evCache.has(id)) { const read = await readEvents(id); if (!evCache.has(id)) evCache.set(id, read); }
  evCache.get(id).push(e);
  // 화면에는 먼저 보이고, 저장은 그다음(저장이 실패해도 화면은 멈추지 않게)
  publish(id, e);
  // 끝·오류·상태는 바로 쓰고, 나머지는 잠깐 모아서 쓴다
  clearTimeout(flushT.get(id));
  const flush = () => ws(id).write(".mudex/events.jsonl", evCache.get(id).map((x) => JSON.stringify(x)).join("\n") + "\n");
  if (["status", "done", "error", "ask", "answer"].includes(ev.type)) await flush();
  else flushT.set(id, setTimeout(() => flush().catch(() => {}), 300));
  if (["tool_result", "done", "error"].includes(ev.type)) publish("*", { type: "jobs_changed" });
}

// 영상·음악 길이와 크기, 영상 썸네일은 브라우저가 직접 잰다(.mudex/probe.json에 저장)
function mediaInfo(url, kind) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video");
    el.preload = "metadata"; el.muted = true; el.src = url;
    const done = (v) => { el.src = ""; resolve(v); };
    el.onloadedmetadata = () => {
      const info = { duration: Number((el.duration || 0).toFixed(3)), width: el.videoWidth || null, height: el.videoHeight || null };
      if (kind !== "video") return done(info);
      el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
      el.onseeked = () => {
        try {
          const c = document.createElement("canvas"); const w = 480; c.width = w; c.height = Math.round((el.videoHeight / el.videoWidth) * w) || 270;
          c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
          c.toBlob((b) => done({ ...info, thumb: b }), "image/jpeg", 0.8);
        } catch { done(info); }
      };
    };
    el.onerror = () => done({});
    setTimeout(() => done({}), 8000);
  });
}
async function listFiles(id) {
  const w = ws(id);
  const cache = await readJson(w, ".mudex/probe.json", {});
  let changed = false;
  const out = [];
  for (const f of await w.list("", { skip: [".mudex", "node_modules", ".git", "tmp", "review"] })) {
    if (f.dir) continue;
    const kind = kindOf(f.path);
    const item = { file: f.path, kind, size: f.size };
    if (kind === "video" || kind === "audio") {
      const key = `${f.path}|${f.lastModified}|${f.size}`;
      if (!cache[key]) {
        const info = await mediaInfo(`/f/${encodeURIComponent(id)}/${f.path.split("/").map(encodeURIComponent).join("/")}`, kind);
        if (info.thumb) await w.write(`.mudex/thumbs/${f.path.replace(/[^\w.-]/g, "_")}.jpg`, info.thumb);
        cache[key] = { duration: info.duration, width: info.width, height: info.height }; changed = true;
      }
      Object.assign(item, cache[key]);
    }
    out.push(item);
  }
  if (changed) await w.write(".mudex/probe.json", JSON.stringify(cache));
  return out;
}

// ---------- 에이전트 실행 ----------
const running = new Map();
async function startRun(id, text) {
  const w = ws(id);
  const messages = await readJson(w, ".mudex/messages.json", []);
  const ac = new AbortController();
  const asks = new Map();
  running.set(id, { ac, asks });
  // 내 채팅을 먼저 띄운다. 준비 단계에서 저장이 실패해도 '일하는 중'에 갇히지 않게 오류로 알린다
  try {
    await emit(id, { type: "user", text });
    await emit(id, { type: "status", running: true });
    await touchJob(id).catch(() => {});
  } catch (e) {
    running.delete(id);
    publish(id, { type: "error", message: `프로젝트 파일을 저장하지 못했습니다: ${e.message}`, at: Date.now() });
    publish(id, { type: "status", running: false, at: Date.now() });
    return;
  }
  // 대화 기억은 80개 항목 안팎으로, 사용자 말에서 끊어 남긴다
  const trim = (h) => { if (h.length <= 80) return h; const i = h.findIndex((m, k) => k >= h.length - 80 && m.role === "user"); return h.slice(Math.max(0, i)); };
  const save = (h) => w.write(".mudex/messages.json", JSON.stringify(trim(h))).catch(() => {});
  let verify = null; // 내보내기·측정 결과(오른쪽 측정값에 보여 준다)
  const ctx = {
    ws: w, job: id, connectors, signal: ac.signal, approval: settings.approval ?? "ask", session: {},
    emit: (ev) => { if (ev.type === "tool_result" && ev.ok && ["export_final", "measure"].includes(ev.name)) verify = ev.result; return emit(id, ev); }, save,
    ask: (kind, payload) => new Promise((resolve, reject) => {
      const askId = crypto.randomUUID();
      asks.set(askId, resolve);
      ac.signal.addEventListener("abort", () => reject(new Error("멈췄습니다.")), { once: true });
      emit(id, { type: "ask", ask_id: askId, kind, ...payload });
    }),
  };
  const t0 = Date.now();
  try {
    const res = await runAgent({ code: settings.code, relay: relay(), model: settings.model ?? DEFAULT_MODEL, effort: settings.effort ?? DEFAULT_EFFORT, instruction: text, messages, ctx });
    await save(res.messages);
    await emit(id, { type: "done", verify, cost_usd: res.totalCost, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    await emit(id, { type: "error", message: e.message });
  } finally {
    running.delete(id);
    await emit(id, { type: "status", running: false }).catch(() => publish(id, { type: "status", running: false, at: Date.now() }));
  }
}

// ---------- 내보내기(zip, 압축 없이 담기) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function exportZip(id) {
  const w = ws(id), enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of await w.list("", { skip: [".mudex", "tmp"] })) {
    if (f.dir) continue;
    const data = await w.readBytes(f.path), name = enc.encode(`${id}/${f.path}`), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length / 2, true); end.setUint16(10, central.length / 2, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const blob = new Blob([...parts, ...central, end], { type: "application/zip" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${id}.zip` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- 상태 ----------
async function state(local) {
  const s = {
    code_set: !!settings.code, code_hint: settings.code ? settings.code.slice(0, 8) + "····" : null, name: settings.name ?? null, cohort: settings.cohort ?? null,
    model: settings.model ?? DEFAULT_MODEL, effort: settings.effort ?? DEFAULT_EFFORT, approval: settings.approval ?? "ask",
    theme: settings.theme ?? "b", skills: [], jobs: await listJobs(), web: true, can_pick_folder: canPickFolder(),
    hf: { logged_in: hf.loggedIn, logging_in: !!hf.pendingLogin },
  };
  if (local) return s;
  await Promise.all([
    settings.code && relayStatus(settings.code, relay()).then((r) => { s.relay = r.ok ? r.body : { error: r.body.error?.message ?? "확인 실패" }; }).catch(() => { s.relay = { error: "인터넷 연결을 확인해 주세요." }; }),
    hf.loggedIn && hf.balance().then((b) => { s.hf.credits = b.credits; s.hf.plan = b.subscription_plan_type; }).catch((e) => { s.hf.error = e.message; s.hf.logged_in = hf.loggedIn; }),
  ]);
  return s;
}

// ---------- 경로 ----------
const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const body = async (init) => (init?.body ? (typeof init.body === "string" ? JSON.parse(init.body) : init.body) : {});
const routes = [
  ["GET", /^\/api\/state$/, async (u) => J(await state(u.searchParams.has("local")))],
  ["POST", /^\/api\/code$/, async (u, init) => {
    const c = String((await body(init)).code ?? "").trim().toUpperCase();
    const r = await relayStatus(c, relay()).catch((e) => ({ ok: false, body: { error: { message: e.message } } }));
    if (!r.ok) return J({ error: r.body.error?.message ?? "코드를 확인하지 못했습니다." }, 400);
    settings.code = c; saveSettings(); return J({ ok: true, relay: r.body });
  }],
  ["POST", /^\/api\/join$/, async (u, init) => {
    const b = await body(init);
    let device = localStorage.getItem("mudex.device");
    if (!device) { device = crypto.randomUUID(); localStorage.setItem("mudex.device", device); }
    const r = await fetch(`${relay()}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry_code: b.entry_code, name: b.name, device_id: device }) });
    const j = await r.json();
    if (!r.ok) return J({ error: j.error?.message ?? "들어가지 못했습니다." }, r.status);
    settings.code = j.code; settings.name = String(b.name).trim(); settings.cohort = j.cohort; saveSettings();
    return J({ ok: true, cohort: j.cohort, again: !!j.again });
  }],
  ["POST", /^\/api\/leave$/, async () => { delete settings.code; delete settings.cohort; saveSettings(); return J({ ok: true }); }],
  ["POST", /^\/api\/settings$/, async (u, init) => {
    const b = await body(init);
    if (b.approval) settings.approval = b.approval === "auto" ? "auto" : "ask";
    if (b.theme) settings.theme = b.theme === "a" ? "a" : "b";
    saveSettings(); return J({ ok: true });
  }],
  ["POST", /^\/api\/model$/, async (u, init) => { const b = await body(init); settings.model = b.model; settings.effort = b.effort; saveSettings(); return J({ ok: true }); }],
  ["POST", /^\/api\/hf\/logout$/, async () => { hf.logout(); return J({ ok: true }); }],
  ["GET", /^\/api\/connectors$/, async () => J({ connectors: connectors.view(), safe_tools: SAFE_TOOLS })],
  ["POST", /^\/api\/connectors$/, async (u, init) => { try { return J(connectors.add(await body(init))); } catch (e) { return J({ error: e.message }, 400); } }],
  ["POST", /^\/api\/connectors\/([^/]+)\/connect$/, async (u, init, [, id]) => J(await connectors.connect(id))],
  ["POST", /^\/api\/connectors\/([^/]+)\/disconnect$/, async (u, init, [, id]) => { connectors.disconnect(id); publish("*", { type: "connectors_changed", id }); return J({ ok: true }); }],
  ["POST", /^\/api\/connectors\/([^/]+)\/remove$/, async (u, init, [, id]) => { connectors.remove(id); publish("*", { type: "connectors_changed", id }); return J({ ok: true }); }],
  ["GET", /^\/api\/connectors\/([^/]+)\/tools$/, async (u, init, [, id]) => J({ tools: await connectors.tools(id) })],
  ["POST", /^\/api\/connectors\/([^/]+)\/call$/, async (u, init, [, id]) => { const b = await body(init); const t0 = performance.now(); const result = await connectors.call(id, b.name, b.args ?? {}); return J({ result, ms: Math.round(performance.now() - t0) }); }],
  ["POST", /^\/api\/jobs$/, async (u, init) => {
    const clean = String((await body(init)).name ?? "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "새 프로젝트";
    const have = new Set(await listProjects());
    let id = clean, n = 2; while (have.has(id)) id = `${clean} ${n++}`;
    await touchJob(id, { name: id });
    return J({ id });
  }],
  ["GET", /^\/api\/jobs\/([^/]+)$/, async (u, init, [, id]) => {
    if (!(await listProjects()).includes(id)) return J({ error: "없는 프로젝트입니다." }, 404);
    if (!evCache.has(id)) { const read = await readEvents(id); if (!evCache.has(id)) evCache.set(id, read); }
    const events = evCache.get(id);
    const files = await listFiles(id);
    const out = files.filter((f) => f.file.startsWith("out/") && f.kind === "video").at(-1)?.file ?? null;
    return J({ id, dir: locals.has(id) ? "내 PC 폴더" : "브라우저 저장소", local: locals.has(id), running: running.has(id), files, events, output: out });
  }],
  ["PUT", /^\/api\/jobs\/([^/]+)\/upload$/, async (u, init, [, id]) => { const name = (u.searchParams.get("name") ?? "file").split(/[\\/]/).pop(); await ws(id).write(name, init.body); await touchJob(id); return J({ ok: true, file: name }); }],
  // 프로젝트 삭제: 브라우저 저장소는 통째로 지우고, 내 PC 폴더는 목록에서만 뺀다(PC의 파일은 건드리지 않는다)
  ["DELETE", /^\/api\/jobs\/([^/]+)$/, async (u, init, [, id]) => {
    if (running.has(id)) return J({ error: "작업 중에는 지울 수 없습니다. 먼저 ■ 단추로 멈춰 주세요." }, 409);
    clearTimeout(flushT.get(id)); flushT.delete(id); evCache.delete(id);
    if (locals.has(id)) await forgetLocal(id);
    else await (await projectsDir()).removeEntry(id, { recursive: true });
    return J({ ok: true });
  }],
  // 대화 지우기: 대화 기록과 무덱스의 기억만 지우고 파일은 남긴다
  ["POST", /^\/api\/jobs\/([^/]+)\/clear$/, async (u, init, [, id]) => {
    if (running.has(id)) return J({ error: "작업 중에는 지울 수 없습니다. 먼저 ■ 단추로 멈춰 주세요." }, 409);
    clearTimeout(flushT.get(id)); flushT.delete(id); evCache.set(id, []);
    for (const f of [".mudex/events.jsonl", ".mudex/messages.json"]) await ws(id).remove(f).catch(() => {});
    return J({ ok: true });
  }],
  ["DELETE", /^\/api\/jobs\/([^/]+)\/files$/, async (u, init, [, id]) => {
    if (running.has(id)) return J({ error: "작업 중에는 지울 수 없습니다. 끝난 뒤에 지워 주세요." }, 409);
    const p = u.searchParams.get("path") ?? "";
    if (!p || p.startsWith(".mudex")) return J({ error: "지울 수 없는 파일입니다." }, 400);
    await ws(id).remove(p); await touchJob(id); publish("*", { type: "jobs_changed" }); return J({ ok: true });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/run$/, async (u, init, [, id]) => {
    const { text } = await body(init);
    if (!text?.trim()) return J({ error: "지시가 비었습니다." }, 400);
    if (running.has(id)) return J({ error: "이 프로젝트는 이미 진행 중입니다." }, 409);
    if (!settings.code) return J({ error: "연수 코드로 먼저 들어와 주세요." }, 400);
    startRun(id, text.trim()); return J({ ok: true });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/answer$/, async (u, init, [, id]) => {
    const { ask_id, value } = await body(init);
    const r = running.get(id); const resolve = r?.asks.get(ask_id);
    if (!resolve) return J({ error: "기다리는 질문이 없습니다." }, 404);
    r.asks.delete(ask_id); await emit(id, { type: "answer", ask_id, value }); resolve(value); return J({ ok: true });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/stop$/, async (u, init, [, id]) => { running.get(id)?.ac.abort(); return J({ ok: true }); }],
  ["POST", /^\/api\/jobs\/([^/]+)\/open$/, async (u, init, [, id]) => { await exportZip(id); return J({ ok: true }); }],
];

// ---------- 가로채기 ----------
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init.method ?? "GET").toUpperCase();
  const path = decodeURIComponent(url.pathname);
  for (const [m, re, fn] of routes) {
    const hit = path.match(re);
    if (hit && m === method) { try { return await fn(url, init, hit); } catch (e) { return J({ error: e.message, need_permission: e.code === "NEED_PERMISSION" || undefined }, e.code === "NEED_PERMISSION" ? 403 : 500); } }
  }
  return J({ error: `없는 경로: ${method} ${path}` }, 404);
};
window.EventSource = LocalEventSource;

// 서비스 워커가 PC 폴더 파일을 읽어 달라고 하면 읽어서 넘긴다(미리보기·썸네일)
navigator.serviceWorker?.addEventListener("message", async (e) => {
  if (e.data?.type !== "mudex-read" || !e.ports[0]) return;
  try { e.ports[0].postMessage({ blob: await ws(e.data.job).file(e.data.path) }); }
  catch { e.ports[0].postMessage({ blob: null }); }
});

// 화면이 직접 부르는 것: PC 폴더 열기·다시 허용
export async function openLocalFolder() {
  const id = await pickLocalFolder(new Set(await listProjects()));
  await touchJob(id, { name: id, local: true });
  publish("*", { type: "jobs_changed" });
  return id;
}
// 서비스 워커로 못 꺼낸 파일(내 PC 폴더 등)을 화면이 직접 읽을 때
export async function fileBlob(id, rel) { return ws(id).file(rel); }
export async function grantFolder(id) { await grantLocal(id); publish("*", { type: "jobs_changed" }); }
// 강제 새로 고침(Ctrl+Shift+R)으로 열면 서비스 워커가 이 창을 안 맡는다. 그때는 맡아 달라고 부탁한다(미리보기가 열리게)
export const ready = navigator.serviceWorker?.register("/sw.js").then(() => navigator.serviceWorker.ready).then(async (reg) => {
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      reg.active?.postMessage({ type: "mudex-claim" });
      setTimeout(resolve, 2000);
    });
  }
  return reg;
}).catch(() => null);
export { settings };
