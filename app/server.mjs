// 무덱스 로컬 서버: 화면(ui/)을 내주고, 작업 폴더·에이전트·힉스필드 로그인을 다룬다.
// 127.0.0.1에만 열린다. 의존성 없음(Node 20+).
//   node app/server.mjs [--port 4870] [--no-open]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Workspace, probe, measureLoudness } from "./ffmpeg_tools.mjs";
import { runAgent, relayStatus, DEFAULT_RELAY, DEFAULT_MODEL, DEFAULT_EFFORT } from "./agent.mjs";
import { Higgsfield } from "./higgsfield.mjs";
import { Connectors, practiceLoginPage, SAFE_TOOLS } from "./connectors.mjs";
import { CloudStorage } from './cloud-storage.mjs';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(APP_DIR, "..");
const UI_DIR = path.join(ROOT, "ui");
const CLOUD = !!process.env.MUDEX_PUBLIC_URL;
const INSTANCE_ID = crypto.randomUUID();
const APP_VERSION = 'cloud-v4';
const PERSIST = path.resolve(process.env.MUDEX_DATA_ROOT ?? ROOT);
const DATA = path.join(PERSIST, "data");
const JOBS = path.join(PERSIST, CLOUD ? 'jobs' : '작업');
const argv = process.argv.slice(2);
const PORT = Number(process.env.PORT) || Number(argv[argv.indexOf("--port") + 1]) || 4870;
if (CLOUD && !process.env.MUDEX_STORE_URL) throw new Error('클라우드 파일 저장소 설정이 필요합니다.');
const cloudStore = CLOUD ? new CloudStorage(PERSIST, process.env.MUDEX_STORE_URL, process.env.MUDEX_STORE_TOKEN, fetch, key => {
  const parts=key.split('/');
  return !(parts[0]==='jobs' && parts[2]==='out' && running.has(parts[1]));
}) : null;
await cloudStore?.restore();
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(JOBS, { recursive: true });

const SETTINGS_FILE = path.join(DATA, "settings.json");
const settings = fs.existsSync(SETTINGS_FILE) ? JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) : {};
const saveSettings = () => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
if (!settings.code && process.env.MUDEX_CODE) { settings.code=process.env.MUDEX_CODE; saveSettings(); }
const relay = () => settings.relay ?? DEFAULT_RELAY;
const hf = new Higgsfield(DATA);
const connectors = new Connectors(DATA, hf, (ev) => broadcastAll({ type: "connectors_changed", ...ev }));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

// ---------- 작업(job) ----------
const jobDir = (id) => {
  const d = path.resolve(JOBS, id);
  if (!d.startsWith(JOBS + path.sep)) throw new Error("잘못된 작업 이름");
  return d;
};
const metaDir = (id) => { const d = path.join(jobDir(id), ".mudex"); fs.mkdirSync(d, { recursive: true }); return d; };
const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return dflt; } };
const busyJobs=new Map(), deletingJobs=new Set(), uploads=new Map();
function existingJobDir(id) {
  const dir=jobDir(id);
  if(!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw Object.assign(new Error('없는 작업입니다.'),{status:404});
  return dir;
}
function removeJobTree(dir) {
  // The caller resolves and checks the job root inside JOBS; symlinks are unlinked, never followed.
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()&&!entry.isSymbolicLink())removeJobTree(file);else fs.unlinkSync(file);
  }
  fs.rmdirSync(dir);
}

function listJobs() {
  return fs.readdirSync(JOBS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
    const meta = readJson(path.join(JOBS, d.name, ".mudex", "meta.json"), {});
    return { id: d.name, name: meta.name ?? d.name, updated: meta.updated ?? fs.statSync(path.join(JOBS, d.name)).mtimeMs, thumb: meta.thumb ?? null, running:running.has(d.name), uploading:(uploads.get(d.name)??0)>0 };
  }).sort((a, b) => b.updated - a.updated);
}
function touchJob(id, patch = {}) {
  const f = path.join(metaDir(id), "meta.json");
  const prior=readJson(f,{});
  const meta = { ...prior, uid:prior.uid??crypto.randomUUID(), ...patch, updated: Date.now() };
  fs.writeFileSync(f, JSON.stringify(meta));
  return meta;
}

// ---------- 실시간 이벤트(SSE) ----------
const clients = new Map(); // jobId -> Set<res>
const running = new Map(); // jobId -> { abort, asks: Map }
function emit(id, ev) {
  const e = { ...ev, at: Date.now() };
  fs.appendFileSync(path.join(metaDir(id), "events.jsonl"), JSON.stringify(e) + "\n");
  for (const res of clients.get(id) ?? []) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (["tool_result", "done", "error", "gen"].includes(ev.type)) broadcastAll({ type: "jobs_changed" });
}
const globalClients = new Set();
function broadcastAll(ev) { for (const res of globalClients) res.write(`data: ${JSON.stringify(ev)}\n\n`); }

async function startRun(id, text) {
  if (running.has(id)) throw new Error("이 작업은 이미 진행 중입니다.");
  if (!settings.code) throw new Error("강사 코드를 먼저 넣어 주세요.");
  const ws = new Workspace(jobDir(id), (line) => fs.appendFileSync(path.join(metaDir(id), "ffmpeg.log"), line + "\n"));
  const chatFile = path.join(metaDir(id), "messages.json");
  const messages = readJson(chatFile, []);
  const ac = new AbortController();
  const asks = new Map();
  running.set(id, { ac, asks });
  touchJob(id);
  emit(id, { type: "user", text });
  emit(id, { type: "status", running: true });
  const ctx = {
    emit: (ev) => emit(id, ev),
    hf,
    connectors,
    signal: ac.signal,
    ask: (kind, payload) => new Promise((resolve, reject) => {
      if(ac.signal.aborted){reject(new Error('멈췄습니다.'));return;}
      const askId = crypto.randomUUID();
      const aborted=()=>{asks.delete(askId);reject(new Error('멈췄습니다.'));};
      asks.set(askId,value=>{ac.signal.removeEventListener('abort',aborted);resolve(value);});
      ac.signal.addEventListener("abort", aborted, { once: true });
      emit(id, { type: "ask", ask_id: askId, kind, ...payload });
    }),
  };
  const t0 = Date.now();
  try {
    const res = await runAgent({ code: settings.code, relay: relay(), model: settings.model ?? DEFAULT_MODEL, effort: settings.effort ?? DEFAULT_EFFORT, ws, instruction: text, messages, ctx });
    // 대화는 이어서 쓰되 너무 길어지지 않게 최근 60개만 남긴다(도구 응답 짝이 깨지지 않게 user에서 자른다)
    let keep = res.messages;
    if (keep.length > 60) { const i = keep.findIndex((m, k) => k >= keep.length - 60 && m.role === "user"); keep = keep.slice(i); }
    fs.writeFileSync(chatFile, JSON.stringify(keep));
    // 에이전트 말과 별개로 결과 파일을 직접 잰다
    const out = latestOutput(id);
    let verify = null;
    if (out) {
      const info = await probe(ws, out);
      verify = { file: out, ...info, loudness: info.has_audio ? await measureLoudness(ws, out) : null, size: fs.statSync(ws.p(out)).size };
      touchJob(id, { thumb: out });
    }
    running.delete(id);
    await cloudStore?.sync();
    emit(id, { type: "done", verify, cost_usd: res.totalCost, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    emit(id, { type: "error", message: e.message });
  } finally {
    running.delete(id);
    emit(id, { type: "status", running: false });
    await cloudStore?.sync().catch(e => broadcastAll({type:'error',message:e.message}));
  }
}

function latestOutput(id) {
  const d = path.join(jobDir(id), "out");
  if (!fs.existsSync(d)) return null;
  const f = fs.readdirSync(d).filter((x) => x.endsWith(".mp4")).map((x) => ({ x, t: fs.statSync(path.join(d, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  return f ? `out/${f.x}` : null;
}

async function listFiles(id) {
  const ws = new Workspace(jobDir(id));
  const out = [];
  for (const f of fs.readdirSync(ws.dir, { recursive: true }).map(String)) {
    const rel = f.split(path.sep).join("/");
    if (/^(\.mudex|tmp|review)(\/|$)/.test(rel)) continue;
    const abs = path.join(ws.dir, f);
    if (!fs.statSync(abs).isFile()) continue;
    const ext = path.extname(rel).toLowerCase();
    const kind = [".mp4", ".mov", ".webm", ".mkv", ".m4v"].includes(ext) ? "video" : [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext) ? "audio" : [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? "image" : null;
    if (!kind) continue;
    const item = { file: rel, kind, size: fs.statSync(abs).size };
    if (kind !== "image") { try { Object.assign(item, await probe(ws, rel)); } catch {} }
    out.push(item);
  }
  return out;
}

// 썸네일: 영상 0.5초 지점 프레임을 .mudex/thumbs에 저장해 둔다
async function thumb(id, rel) {
  const ws = new Workspace(jobDir(id));
  const src = ws.p(rel);
  const key = crypto.createHash("md5").update(rel + fs.statSync(src).mtimeMs).digest("hex") + ".jpg";
  const dst = path.join(metaDir(id), "thumbs", key);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const isImg = /\.(png|jpe?g|webp)$/i.test(rel);
    await ws.ff([...(isImg ? [] : ["-ss", "0.5"]), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", dst]);
  }
  return dst;
}

// ---------- HTTP ----------
async function sendJson(res, status, body) {
  try { await cloudStore?.sync(); }
  catch(e) { status=503; body={error:e.message}; }
  if(body && typeof body==='object' && 'storage_error' in body) {body.saved_at=cloudStore?.lastSaved ?? null;body.storage_error=cloudStore?.error ?? null;}
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("너무 큽니다")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
const readJsonBody = async (req) => { const b = await readBody(req); return b.length ? JSON.parse(b.toString("utf8")) : {}; };

function serveFile(req, res, abs) {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(abs).size;
  const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    fs.createReadStream(abs, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    fs.createReadStream(abs).pipe(res);
  }
}

async function state() {
  const s = { code_set: !!settings.code, code_hint: settings.code ? settings.code.slice(0, 8) + "····" : null, model: settings.model ?? DEFAULT_MODEL, effort: settings.effort ?? DEFAULT_EFFORT, jobs: listJobs(), hf: { logged_in: hf.loggedIn, logging_in: !!hf.pendingLogin } };
  // 중계 서버와 힉스필드는 동시에 묻는다
  await Promise.all([
    settings.code && relayStatus(settings.code, relay())
      .then((r) => { s.relay = r.ok ? r.body : { error: r.body.error?.message ?? "확인 실패" }; })
      .catch((e) => { s.relay = { error: "중계 서버에 닿지 않습니다: " + e.message }; }),
    hf.loggedIn && hf.balance()
      .then((b) => { s.hf.credits = b.credits; s.hf.plan = b.subscription_plan_type; })
      .catch((e) => { s.hf.error = e.message; s.hf.logged_in = hf.loggedIn; }),
  ]);
  return {...s, cloud:CLOUD, instance_id:INSTANCE_ID, app_version:APP_VERSION, workspace_id:process.env.MUDEX_WORKSPACE_ID??'local', storage_error:cloudStore?.error ?? null};
}

const routes = [
  ["GET", /^\/health$/, async (req,res) => sendJson(res,200,{ok:true,running:running.size})],
  ["POST", /^\/__cloud\/flush$/, async (req,res) => {
    if (running.size) return sendJson(res,409,{error:'영상 작업이 진행 중입니다.'});
    await cloudStore?.sync();
    return sendJson(res,200,{ok:true});
  }],
  ["GET", /^\/oauth\/callback\/(hf|mcp_[a-f0-9]+)$/, async (req,res,[,key]) => {
    await connectors.completeLogin(key,new URL(req.url,process.env.MUDEX_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`));
    await cloudStore?.sync();
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>무덱스 연결 완료</title><p>연결되었습니다. 이 창을 닫고 무덱스로 돌아가세요.</p><a href="/">무덱스로 돌아가기</a></html>');
  }],
  ["GET", /^\/api\/state$/, async (req, res) => sendJson(res, 200, await state())],
  ["POST", /^\/api\/code$/, async (req, res) => {
    const { code } = await readJsonBody(req);
    const c = String(code ?? "").trim().toUpperCase();
    if (CLOUD && c!==process.env.MUDEX_CODE) return sendJson(res,400,{error:'다른 강사 코드는 입장 화면에서 연결해 주세요.'});
    const r = await relayStatus(c, relay()).catch((e) => ({ ok: false, body: { error: { message: e.message } } }));
    if (!r.ok) return sendJson(res, 400, { error: r.body.error?.message ?? "코드를 확인하지 못했습니다." });
    settings.code = c; saveSettings();
    sendJson(res, 200, { ok: true, relay: r.body });
  }],
  ["POST", /^\/api\/model$/, async (req, res) => { const { model, effort } = await readJsonBody(req); settings.model = model; settings.effort = effort; saveSettings(); sendJson(res, 200, { ok: true }); }],
  ["POST", /^\/api\/hf\/login$/, async (req, res) => {
    const url = await hf.startLogin();
    hf.pendingLogin?.done.then(() => broadcastAll({ type: "hf_changed" }), (e) => broadcastAll({ type: "hf_changed", error: e.message }));
    sendJson(res, 200, { url });
  }],
  ["POST", /^\/api\/hf\/logout$/, async (req, res) => {
    for(const c of connectors.list)if(!c.practice&&new URL(c.url).host===new URL(hf.url).host)connectors.disconnect(c.id);
    hf.logout();return sendJson(res,200,{ok:true});
  }],
  // 커넥터(원격 MCP): 추가 → 연결(진짜 OAuth / 연습) → 도구 목록 → 조회 도구 눌러 보기
  ["GET", /^\/api\/connectors$/, async (req, res) => sendJson(res, 200, { connectors: connectors.view(), safe_tools: SAFE_TOOLS })],
  ["POST", /^\/api\/connectors$/, async (req, res) => sendJson(res, 200, connectors.add(await readJsonBody(req)))],
  ["POST", /^\/api\/connectors\/([^/]+)\/connect$/, async (req, res, [, id]) => sendJson(res, 200, await connectors.connect(id, process.env.MUDEX_PUBLIC_URL ?? `http://127.0.0.1:${PORT}`))],
  ["POST", /^\/api\/connectors\/([^/]+)\/disconnect$/, async (req, res, [, id]) => { connectors.disconnect(id); broadcastAll({ type: "connectors_changed", id }); sendJson(res, 200, { ok: true }); }],
  ["POST", /^\/api\/connectors\/([^/]+)\/remove$/, async (req, res, [, id]) => { connectors.remove(id); broadcastAll({ type: "connectors_changed", id }); sendJson(res, 200, { ok: true }); }],
  ["GET", /^\/api\/connectors\/([^/]+)\/tools$/, async (req, res, [, id]) => sendJson(res, 200, { tools: await connectors.tools(id) })],
  ["POST", /^\/api\/connectors\/([^/]+)\/prepare$/, async(req,res,[,id])=>{
    const {name,args}=await readJsonBody(req);return sendJson(res,200,await connectors.prepareCall(id,name,args??{}));
  }],
  ["POST", /^\/api\/connectors\/([^/]+)\/call$/, async (req, res, [, id]) => {
    const { name, args, approval_token } = await readJsonBody(req);
    const t0 = Date.now();
    const result = await connectors.call(id, name, args ?? {},{approval_token});
    sendJson(res, 200, { result, ms: Date.now() - t0 });
  }],
  ["GET", /^\/practice\/authorize$/, async (req, res) => {
    const c = connectors.get(new URL(req.url, "http://x").searchParams.get("c"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(practiceLoginPage(c));
  }],
  ["POST", /^\/practice\/approve$/, async (req, res) => {
    const id = new URL(req.url, "http://x").searchParams.get("c");
    connectors.practiceApprove(id);
    await cloudStore?.sync();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(practiceLoginPage(connectors.get(id), true));
  }],
  ["POST", /^\/api\/jobs$/, async (req, res) => {
    const { name } = await readJsonBody(req);
    const clean = String(name ?? "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "새 작업";
    let id = clean, n = 2;
    while (fs.existsSync(path.join(JOBS, id))) id = `${clean} ${n++}`;
    fs.mkdirSync(path.join(JOBS, id), { recursive: true });
    touchJob(id, { name: id });
    return sendJson(res, 200, { id });
  }],
  ["PATCH", /^\/api\/jobs\/([^/]+)$/, async(req,res,[,id])=>{
    const {name}=await readJsonBody(req);
    const clean=typeof name==='string'?name.replace(/[\x00-\x1f]/g,' ').trim():'';
    if(!clean || [...clean].length>40)return sendJson(res,400,{error:'작업 이름은 1~40자로 넣어 주세요.'});
    touchJob(id,{name:clean});broadcastAll({type:'jobs_changed'});
    return sendJson(res,200,{id,name:clean});
  }],
  ["DELETE", /^\/api\/jobs\/([^/]+)$/, async(req,res,[,id])=>{
    if(running.has(id)||(busyJobs.get(id)??0)>0)return sendJson(res,409,{error:'작업이나 파일 처리가 끝난 뒤 삭제해 주세요.'});
    deletingJobs.add(id);
    try {
      const dir=existingJobDir(id), remove=()=>removeJobTree(dir);
      if(cloudStore)await cloudStore.sync(remove);else remove();
      for(const client of clients.get(id)??[])client.end();clients.delete(id);
      broadcastAll({type:'job_deleted',id});broadcastAll({type:'jobs_changed'});
      return await sendJson(res,200,{ok:true});
    } finally {deletingJobs.delete(id);}
  }],
  ["GET", /^\/api\/jobs\/([^/]+)$/, async (req, res, [, id]) => {
    const metadataFile=path.join(metaDir(id),'meta.json'),metadata=readJson(metadataFile,{});
    if(!metadata.uid){metadata.uid=crypto.randomUUID();fs.writeFileSync(metadataFile,JSON.stringify(metadata));}
    const evFile = path.join(metaDir(id), "events.jsonl");
    const events = fs.existsSync(evFile) ? fs.readFileSync(evFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return sendJson(res, 200, { id, uid:metadata.uid, workspace_id:process.env.MUDEX_WORKSPACE_ID??'local', name:metadata.name??id, dir: jobDir(id), running: running.has(id), files: await listFiles(id), events, output: latestOutput(id) });
  }],
  ["GET", /^\/api\/jobs\/([^/]+)\/files$/, async (req, res, [, id]) => sendJson(res, 200, await listFiles(id))],
  ["PUT", /^\/api\/jobs\/([^/]+)\/upload$/, async (req, res, [, id]) => {
    const name = path.basename(decodeURIComponent(new URL(req.url, "http://x").searchParams.get("name") ?? "file"));
    if (!name || name.startsWith('.') || /[\\/\x00-\x1f]/.test(name)) return sendJson(res,400,{error:'파일 이름을 확인해 주세요.'});
    const ws=new Workspace(jobDir(id));
    const uploadUrl=new URL(req.url,'http://localhost');
    const relative=uploadUrl.searchParams.get('relative');
    if(relative && (relative.length>512 || relative.split('/').some(part=>!part || part==='.' || part==='..' || /[\\\x00-\x1f:*?"<>|]/.test(part))))return sendJson(res,400,{error:'폴더의 파일 경로를 확인해 주세요.'});
    const dst = ws.outPath(relative?'inputs/'+relative:name);
    const offset=Number(uploadUrl.searchParams.get('offset') ?? 0);
    const partial=dst+'.part';
    if (!Number.isSafeInteger(offset) || offset<0 || offset>2*1024**3) return sendJson(res,400,{error:'파일 크기 한도는 2GB입니다.'});
    if (offset && (!fs.existsSync(partial) || fs.statSync(partial).size!==offset)) return sendJson(res,409,{error:'업로드 순서가 맞지 않습니다. 다시 올려 주세요.'});
    await new Promise((resolve, reject) => {
      const w=fs.createWriteStream(partial,{flags:offset?'a':'w'});let size=offset;
      req.on('data',chunk=>{size+=chunk.length;if(size>2*1024**3)req.destroy(new Error('파일 크기 한도는 2GB입니다.'));});
      req.on('error',e=>{w.destroy();reject(e);});req.pipe(w);w.on('finish',resolve);w.on('error',reject);
    });
    if (uploadUrl.searchParams.get('final')!=='false') fs.renameSync(partial,dst);
    touchJob(id);
    return sendJson(res, 200, { ok: true, file: relative?'inputs/'+relative:name });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/run$/, async (req, res, [, id]) => {
    const { text } = await readJsonBody(req);
    if (!text?.trim()) return sendJson(res, 400, { error: "지시가 비었습니다." });
    if (running.has(id)) return sendJson(res, 409, { error: "이 작업은 이미 진행 중입니다." });
    if (!settings.code) return sendJson(res, 400, { error: "강사 코드를 먼저 넣어 주세요." });
    startRun(id, text.trim());
    sendJson(res, 200, { ok: true });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/answer$/, async (req, res, [, id]) => {
    const { ask_id, value } = await readJsonBody(req);
    const r = running.get(id);
    const resolve = r?.asks.get(ask_id);
    if (!resolve) return sendJson(res, 404, { error: "기다리는 질문이 없습니다." });
    r.asks.delete(ask_id);
    emit(id, { type: "answer", ask_id, value });
    resolve(value);
    sendJson(res, 200, { ok: true });
  }],
  ["POST", /^\/api\/jobs\/([^/]+)\/stop$/, async (req, res, [, id]) => { running.get(id)?.ac.abort(); sendJson(res, 200, { ok: true }); }],
  ["POST", /^\/api\/jobs\/([^/]+)\/open$/, async (req, res, [, id]) => {
    if (CLOUD) return sendJson(res,400,{error:'파일 탭에서 결과를 내려받아 주세요.'});
    spawn("explorer.exe", [jobDir(id)], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { ok: true });
  }],
  ["GET", /^\/api\/jobs\/([^/]+)\/events$/, async (req, res, [, id]) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": hi\n\n");
    if (!clients.has(id)) clients.set(id, new Set());
    clients.get(id).add(res);
    req.on("close", () => clients.get(id)?.delete(res));
  }],
  ["GET", /^\/api\/events$/, async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": hi\n\n");
    globalClients.add(res);
    req.on("close", () => globalClients.delete(res));
  }],
  ["GET", /^\/f\/([^/]+)\/(.+)$/, async (req, res, [, id, rel]) => serveFile(req, res, new Workspace(jobDir(id)).p(rel))],
  ["GET", /^\/thumb\/([^/]+)\/(.+)$/, async (req, res, [, id, rel]) => serveFile(req, res, await thumb(id, rel))],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = decodeURIComponent(url.pathname);
  try {
    for (const [method, re, fn] of routes) {
      const m = p.match(re);
      if (m && req.method === method) {
        // 작업 이름은 decode된 경로에서 뽑았으니 그대로 쓴다
        const selected=p.match(/^\/(?:api\/jobs|f|thumb)\/([^/]+)(?:\/|$)/)?.[1];
        if(selected) {
          if(deletingJobs.has(selected))return sendJson(res,409,{error:'이 작업을 삭제하고 있습니다.'});
          existingJobDir(selected);
        }
        const counted=selected && req.method!=='DELETE' && !p.endsWith('/events');
        const uploading=counted&&req.method==='PUT'&&p.endsWith('/upload');
        if(counted)busyJobs.set(selected,(busyJobs.get(selected)??0)+1);
        if(uploading)uploads.set(selected,(uploads.get(selected)??0)+1);
        try {return await fn(req,res,m);}
        finally {
          if(counted) {const n=busyJobs.get(selected)-1;n?busyJobs.set(selected,n):busyJobs.delete(selected);}
          if(uploading) {const n=uploads.get(selected)-1;n?uploads.set(selected,n):uploads.delete(selected);}
        }
      }
    }
    if (req.method === "GET") {
      const rel = p === "/" ? "index.html" : p.slice(1);
      const abs = path.resolve(UI_DIR, rel);
      if (abs.startsWith(UI_DIR)) return serveFile(req, res, abs);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    if (!res.headersSent) return sendJson(res, e.status??500, { error: e.message });
    else res.end();
  }
});

// 이미 켜져 있으면(두 번 눌렀을 때) 창만 다시 연다
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  console.log("무덱스가 이미 켜져 있어 창만 엽니다.");
  if (!argv.includes("--no-open")) openAppWindow(`http://127.0.0.1:${PORT}/`);
  setTimeout(() => process.exit(0), 500);
});
server.listen(PORT, CLOUD ? '0.0.0.0' : "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`무덱스 준비됨: ${url}`);
  if (!CLOUD && !argv.includes("--no-open")) openAppWindow(url);
});

if (CLOUD) setInterval(()=>cloudStore.sync().catch(e=>console.error(e.message)),15000).unref();
export { server };

// 엣지를 주소창 없는 앱 창으로 연다. 없으면 기본 브라우저.
function openAppWindow(url) {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  const edge = candidates.find((c) => fs.existsSync(c));
  if (edge) {
    spawn(edge, [`--app=${url}`, `--user-data-dir=${path.join(DATA, "edge")}`, "--window-size=1440,900", "--no-first-run"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("rundll32", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  }
}
