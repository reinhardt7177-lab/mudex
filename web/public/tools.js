// 웹판 기본 도구: 코덱스처럼 프로젝트 폴더(브라우저 저장소)의 파일을 보고·읽고·쓰고·고친다.
// PC판의 명령 실행 대신 run_js(브라우저 샌드박스에서 자바스크립트 실행)와 check_page(웹페이지를 열어 오류 확인)를 쓴다.
// ctx: { ws, emit, ask, approval, session, code, relay, signal, job }
import { kindOf, mimeOf } from "./opfs.js";
import { relayPost } from "./agent.js";
import { TOOL_KO } from "./connectors.js";

const TEXT_EXT = /\.(txt|md|html?|css|js|mjs|cjs|ts|tsx|jsx|json|csv|tsv|py|xml|svg|yml|yaml|toml|ini|srt|vtt|log)$/i;
const MAX = 12000;
const clip = (s, n = MAX) => (s.length > n ? s.slice(0, n / 2) + `\n…(${s.length - n}자 줄임)…\n` + s.slice(-n / 2) : s);
const size = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);

// run_js: 웹 워커(샌드박스) 안에서 코드를 실행. fs는 이 프로젝트 안만 읽고 쓴다.
function runInWorker(code, ws, timeoutMs, signal) {
  const prelude = `
    const send = (m) => postMessage(m);
    const logs = [];
    const fmt = (a) => a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ");
    console.log = (...a) => logs.push(fmt(a)); console.info = console.log; console.warn = (...a) => logs.push("경고: " + fmt(a)); console.error = (...a) => logs.push("오류: " + fmt(a));
    let seq = 0; const waits = new Map();
    onmessage = (e) => { const w = waits.get(e.data.id); if (w) { waits.delete(e.data.id); e.data.error ? w.reject(new Error(e.data.error)) : w.resolve(e.data.value); } };
    const call = (op, ...args) => new Promise((resolve, reject) => { const id = ++seq; waits.set(id, { resolve, reject }); send({ type: "fs", id, op, args }); });
    const fs = { readText: (p) => call("readText", p), writeText: (p, t) => call("writeText", p, t), list: (p = "") => call("list", p), exists: (p) => call("exists", p) };
    (async () => {
      try { const result = await (async () => { ${"\n"}__CODE__${"\n"} })(); send({ type: "done", logs, result: result === undefined ? undefined : fmt([result]) }); }
      catch (err) { send({ type: "done", logs, error: String(err && err.stack || err) }); }
    })();`;
  const src = prelude.replace("__CODE__", code);
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  const w = new Worker(url);
  return new Promise((resolve) => {
    const finish = (r) => { clearTimeout(timer); w.terminate(); URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => finish({ logs: [], error: `${timeoutMs / 1000}초가 지나 멈췄습니다` }), timeoutMs);
    signal?.addEventListener("abort", () => finish({ logs: [], error: "사용자가 멈췄습니다" }), { once: true });
    w.onerror = (e) => finish({ logs: [], error: e.message || "문법 오류" });
    w.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "done") return finish(m);
      if (m.type !== "fs") return;
      try {
        let value;
        if (m.op === "readText") value = await ws.readText(m.args[0]);
        else if (m.op === "writeText") { await ws.write(m.args[0], String(m.args[1])); value = true; }
        else if (m.op === "list") value = (await ws.list(m.args[0] ?? "")).map((f) => f.path);
        else if (m.op === "exists") value = await ws.exists(m.args[0]);
        w.postMessage({ id: m.id, value });
      } catch (err) { w.postMessage({ id: m.id, error: err.message }); }
    };
  });
}

// check_page: 웹페이지를 숨은 틀에서 열어 콘솔 오류·제목·글 양을 잰다
async function checkPage(job, path, seconds = 2.5) {
  const base = `/f/${encodeURIComponent(job)}/${path.split("/").slice(0, -1).map(encodeURIComponent).join("/")}${path.includes("/") ? "/" : ""}`;
  const html = await (await fetch(`/f/${encodeURIComponent(job)}/${path.split("/").map(encodeURIComponent).join("/")}`)).text();
  const probe = `<base href="${base}"><script>(function(){var P=parent;function s(k,m){try{P.postMessage({__mudexCheck:1,k:k,m:String(m).slice(0,400)},"*")}catch(e){}}
    var oe=console.error;console.error=function(){s("console",[].slice.call(arguments).join(" "));oe.apply(console,arguments)};
    addEventListener("error",function(e){s("error",(e.message||"리소스를 못 불러옴")+(e.filename?" @ "+e.filename.split("/").pop()+":"+e.lineno:"")+(e.target&&e.target.src?" "+e.target.src.split("/").pop():""))},true);
    addEventListener("unhandledrejection",function(e){s("promise",e.reason&&e.reason.message||e.reason)});})();<\/script>`;
  const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + probe) : probe + html;
  const issues = [];
  const onMsg = (e) => { if (e.data?.__mudexCheck) issues.push(`${e.data.k}: ${e.data.m}`); };
  window.addEventListener("message", onMsg);
  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:800px;opacity:0;pointer-events:none";
  fr.setAttribute("sandbox", "allow-scripts allow-same-origin");
  document.body.append(fr);
  fr.srcdoc = doc;
  await new Promise((r) => setTimeout(r, seconds * 1000));
  let info = {};
  try {
    const d = fr.contentDocument;
    info = { title: d.title, text_chars: (d.body?.innerText ?? "").trim().length, buttons: d.querySelectorAll("button, [role=button], input[type=button]").length, images: d.images.length, broken_images: [...d.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")).slice(0, 5) };
  } catch {}
  window.removeEventListener("message", onMsg);
  fr.remove();
  return { path, ...info, errors: issues.slice(0, 20), ok: issues.length === 0 };
}

export const CORE_TOOLS = [
  {
    name: "update_plan",
    description: "할 일 목록을 화면 아래에 보여 준다. 여러 단계 일을 시작할 때 3~6단계로 세우고, 단계가 끝날 때마다 done_count를 올려 다시 부른다.",
    parameters: { type: "object", properties: { steps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 }, done_count: { type: "integer", minimum: 0 } }, required: ["steps", "done_count"], additionalProperties: false },
    async run(a, ctx) { ctx.emit({ type: "plan", steps: a.steps, done: a.done_count }); return { ok: true }; },
  },
  {
    name: "list_files",
    description: "프로젝트 폴더의 파일과 폴더를 크기와 함께 보여 준다. path는 프로젝트 폴더 기준(비우면 맨 위).",
    parameters: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
    async run(a, ctx) {
      const files = await ctx.ws.list(a.path ?? "");
      return { files: files.slice(0, 400).map((f) => (f.dir ? f.path : `${f.path}  (${size(f.size)})`)) };
    },
  },
  {
    name: "read_file",
    description: "글자로 된 파일을 읽는다(코드·HTML·CSV·자막 등). 영상·사진 같은 바이너리는 크기만 알려 준다. offset·limit은 줄 번호(1부터).",
    parameters: { type: "object", properties: { path: { type: "string" }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 3000 } }, required: ["path"], additionalProperties: false },
    async run(a, ctx) {
      const f = await ctx.ws.file(a.path);
      if (!TEXT_EXT.test(a.path) && f.size > 0) return { path: a.path, binary: true, size: f.size, kind: kindOf(a.path), note: "글자 파일이 아닙니다." };
      const lines = (await f.text()).split(/\r?\n/);
      const from = (a.offset ?? 1) - 1;
      const part = lines.slice(from, from + (a.limit ?? 2000));
      return { path: a.path, total_lines: lines.length, from: from + 1, text: clip(part.map((l, i) => `${from + i + 1}\t${l}`).join("\n"), 40000) };
    },
  },
  {
    name: "write_file",
    description: "파일을 새로 만들거나 통째로 덮어쓴다. 폴더가 없으면 만든다. 이미 있는 파일 일부만 바꿀 때는 edit_file을 쓴다.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    async run(a, ctx) {
      const existed = await ctx.ws.exists(a.path);
      const before = existed ? (await ctx.ws.readText(a.path)).split(/\r?\n/).length : 0;
      await ctx.ws.write(a.path, a.content);
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, created: !existed, lines: a.content.split(/\r?\n/).length, lines_before: before };
    },
  },
  {
    name: "edit_file",
    description: "파일의 일부를 바꾼다. old_text는 파일에 그대로(공백·줄바꿈까지) 있어야 하고 한 군데만 있어야 한다(여러 곳이면 replace_all).",
    parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } }, required: ["path", "old_text", "new_text"], additionalProperties: false },
    async run(a, ctx) {
      const src = await ctx.ws.readText(a.path);
      const n = src.split(a.old_text).length - 1;
      if (n === 0) throw new Error("old_text를 파일에서 찾지 못했습니다. read_file로 지금 내용을 다시 보세요.");
      if (n > 1 && !a.replace_all) throw new Error(`old_text가 ${n}군데 있습니다. 더 길게 잡거나 replace_all을 쓰세요.`);
      await ctx.ws.write(a.path, a.replace_all ? src.split(a.old_text).join(a.new_text) : src.replace(a.old_text, () => a.new_text));
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, replaced: a.replace_all ? n : 1 };
    },
  },
  {
    name: "run_js",
    description: "자바스크립트를 브라우저 샌드박스(웹 워커)에서 실행하고 console.log 출력과 마지막 return 값을 돌려준다. 계산·자료 만들기·검사에 쓴다. 화면(DOM)은 없고, 프로젝트 파일은 await fs.readText(경로) / fs.writeText(경로, 글) / fs.list() / fs.exists(경로)로 다룬다. 승인 모드가 '물어보고 하기'면 실행 전에 허락을 받는다.",
    parameters: { type: "object", properties: { code: { type: "string", description: "async 함수 본문. 예: const t = await fs.readText('index.html'); return t.length;" }, why: { type: "string", description: "무엇을 하려는지 한 줄(허락 카드에 보임)" }, timeout_seconds: { type: "integer", minimum: 1, maximum: 120 } }, required: ["code", "why"], additionalProperties: false },
    async run(a, ctx) {
      if (ctx.approval !== "auto" && !ctx.session.commandsOk) {
        const ans = await ctx.ask("approve", { kind2: "command", title: "이 코드를 실행할까요?", why: a.why, command: a.code });
        if (ans === "always") ctx.session.commandsOk = true; else if (ans !== "yes") return { approved: false, user_said: ans };
      }
      const r = await runInWorker(a.code, ctx.ws, (a.timeout_seconds ?? 20) * 1000, ctx.signal);
      const output = [...(r.logs ?? []), ...(r.result !== undefined ? [`← ${r.result}`] : []), ...(r.error ? [`오류: ${r.error}`] : [])].join("\n");
      ctx.emit({ type: "term", command: a.code, exit_code: r.error ? 1 : 0, output: clip(output, 20000), killed: "" });
      return { ok: !r.error, output: clip(output) };
    },
  },
  {
    name: "check_page",
    description: "프로젝트의 웹페이지를 숨은 창에서 실제로 열어 보고 자바스크립트 오류, 못 불러온 그림·파일, 제목, 글 양, 버튼 수를 알려 준다. 웹페이지를 만들거나 고친 뒤 꼭 한 번 확인한다.",
    parameters: { type: "object", properties: { path: { type: "string", description: "예: index.html" } }, required: ["path"], additionalProperties: false },
    async run(a, ctx) { return checkPage(ctx.job, a.path); },
  },
  {
    name: "download_file",
    description: "https 주소의 파일을 프로젝트 폴더로 내려받는다(예: MCP 생성 결과 영상·사진).",
    parameters: { type: "object", properties: { url: { type: "string" }, path: { type: "string", description: "저장할 곳, 예: clips/scene1.mp4" } }, required: ["url", "path"], additionalProperties: false },
    async run(a, ctx) {
      if (!/^https:\/\//i.test(a.url)) throw new Error("https 주소만 받을 수 있습니다.");
      const r = await fetch(a.url, { signal: ctx.signal });
      if (!r.ok) throw new Error(`내려받기 실패 ${r.status}`);
      const blob = await r.blob();
      await ctx.ws.write(a.path, blob);
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, size: blob.size, content_type: r.headers.get("content-type") };
    },
  },
  {
    name: "upload_file",
    description: "프로젝트 파일을 미리 받은 업로드 주소(presigned URL)로 PUT 한다. MCP 도구가 '이 주소로 올리라'고 할 때 쓴다(예: 힉스필드 media_upload → upload_file → media_confirm).",
    parameters: { type: "object", properties: { path: { type: "string" }, url: { type: "string" }, content_type: { type: "string" } }, required: ["path", "url"], additionalProperties: false },
    async run(a, ctx) {
      if (!/^https:\/\//i.test(a.url)) throw new Error("https 주소에만 올릴 수 있습니다.");
      const body = await ctx.ws.file(a.path);
      const r = await fetch(a.url, { method: "PUT", headers: { "Content-Type": a.content_type ?? mimeOf(a.path).split(";")[0] }, body, signal: ctx.signal });
      if (!r.ok) throw new Error(`올리기 실패 ${r.status}`);
      return { ok: true, status: r.status, size: body.size };
    },
  },
  {
    name: "make_image",
    description: "Sunburst로 그림을 그린다(강사 API 사용, 힉스필드 크레딧 0). 기본은 높은 품질(high), 1536x1024이다. 사용자가 요청한 경우에만 품질을 낮춘다. 영어 프롬프트로 장면·빛·구도를 구체적으로. 결과는 path_prefix_1.png … 로 저장.",
    parameters: { type: "object", properties: { prompt: { type: "string" }, path_prefix: { type: "string", description: "예: images/mudball" }, count: { type: "integer", minimum: 1, maximum: 4 }, size: { type: "string", enum: ["1536x1024", "1024x1024", "1024x1536"] }, quality: { type: "string", enum: ["low", "medium", "high"], description: "기본 high. 사용자가 요청한 경우에만 medium 또는 low를 사용한다." } }, required: ["prompt", "path_prefix"], additionalProperties: false },
    async run(a, ctx) {
      const model = "gpt-image-2.6-sunburst";
      const quality = a.quality ?? "high";
      const imageSize = a.size ?? "1536x1024";
      const j = await relayPost(ctx.relay, "/v1/images/generations", ctx.code, { model, prompt: a.prompt, n: a.count ?? 1, size: imageSize, quality }, ctx.signal);
      const files = [];
      for (const [i, d] of j.data.entries()) {
        const rel = `${a.path_prefix.replace(/\.png$/i, "")}_${i + 1}.png`;
        await ctx.ws.write(rel, Uint8Array.from(atob(d.b64_json), (c) => c.charCodeAt(0)));
        files.push(rel); ctx.emit({ type: "file_changed", path: rel });
      }
      if (j.mudex) ctx.emit({ type: "cost", cost_usd: j.mudex.cost_usd, remaining_usd: j.mudex.remaining_usd });
      return { files, model, quality, size: imageSize, cost_usd: j.mudex?.cost_usd };
    },
  },
  {
    name: "read_guide",
    description: "무덱스에 들어 있는 작업 양식을 읽는다. storyboard: 영상 스토리보드(컷·시간·샷·카메라·소리·전환 칸과 시트 모양), character_board: 캐릭터 보드(턴어라운드·표정·팔레트·그림 지시문 블록). 그 일을 시작할 때 읽고 따른다. 사용자가 다른 양식을 말하면 사용자 것을 따른다.",
    parameters: { type: "object", properties: { name: { type: "string", enum: ["storyboard", "character_board"] } }, required: ["name"], additionalProperties: false },
    async run(a) {
      const r = await fetch(`/guides/${a.name}.md`);
      if (!r.ok) throw new Error(`양식을 찾지 못했습니다: ${a.name}`);
      return { guide: await r.text() };
    },
  },
  {
    name: "ask_user",
    description: "사용자에게 고르게 한다. files를 주면 사진·영상을 보여 주고 하나를 고르게, options를 주면 글자 버튼으로 고르게 한다. 고른 값(파일 경로나 보기 글)을 돌려주고, 사용자가 다른 말을 하면 그 말을 돌려준다.",
    parameters: { type: "object", properties: { question: { type: "string" }, files: { type: "array", items: { type: "string" }, maxItems: 8 }, options: { type: "array", items: { type: "string" }, maxItems: 6 } }, required: ["question"], additionalProperties: false },
    async run(a, ctx) { return ctx.ask("pick", { question: a.question, files: a.files ?? [], options: a.options ?? [] }); },
  },
];

// ---- MCP 다리: 찾기 → 설명 → 부르기(PC판 mcp_bridge와 같은 규칙)
// 크레딧이 들지 않는 도구는 묻지 않고 바로 한다(올리기·올린 것 확인·비용 미리 보기 포함)
const READ_ONLY = /^(balance|transactions|models_explore|list_|get_|search|show_|job_status|jobs_wait|job_display|apps_search|apps_describe|media_upload|media_confirm|estimate_)/;
// 비용 미리 보기 결과(견적 번호 → 크레딧). 견적 번호로 만들 때 허락 카드에 크레딧을 보여 주려고 기억해 둔다.
const QUOTES = new Map();
function costPreviewArgs(schema, args) {
  const p = schema?.properties ?? {};
  if ((p.params?.anyOf?.some((x) => x.properties?.get_cost) || p.params?.properties?.get_cost) && args.params && typeof args.params === "object") return { ...args, params: { ...args.params, get_cost: true } };
  if (p.get_cost) return { ...args, get_cost: true };
  return null;
}
function applyPresetDecline(args, res) {
  const retry = res?.notice?.type === "preset_recommendation" && res.notice.data?.retry_literal_with;
  if (!retry) return null;
  return args.params ? { ...args, params: { ...args.params, ...retry } } : { ...args, ...retry };
}

export const MCP_TOOLS = [
  {
    name: "mcp_list_tools",
    description: "연결된 커넥터(MCP 서버)와 그 도구를 찾는다. query로 이름·설명을 걸러 본다(예: video, upload, balance). 부르기 전에 mcp_describe로 입력 모양을 확인한다.",
    parameters: { type: "object", properties: { connector: { type: "string" }, query: { type: "string" } }, additionalProperties: false },
    async run(a, ctx) {
      const list = ctx.connectors.connected().filter((c) => !a.connector || c.name.toLowerCase() === a.connector.toLowerCase() || c.id === a.connector);
      if (!list.length) return { connectors: [], note: "연결된 커넥터가 없습니다. 사용자에게 왼쪽 아래 '커넥터'에서 연결해 달라고 안내하세요." };
      const q = (a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const out = [];
      for (const c of list) {
        const tools = await ctx.connectors.tools(c.id);
        const hits = tools.filter((t) => !q.length || q.some((w) => t.name.toLowerCase().includes(w) || (t.description ?? "").toLowerCase().includes(w)));
        out.push({ connector: c.name, practice: !!c.practice, total: tools.length, tools: hits.slice(0, 40).map((t) => ({ name: t.name, summary: (t.description ?? "").replace(/\s+/g, " ").slice(0, 160) })) });
      }
      return { connectors: out };
    },
  },
  {
    name: "mcp_describe",
    description: "커넥터 도구 하나의 전체 설명과 입력 모양(JSON 스키마)을 본다.",
    parameters: { type: "object", properties: { connector: { type: "string" }, tool: { type: "string" } }, required: ["tool"], additionalProperties: false },
    async run(a, ctx) {
      const c = ctx.connectors.find(a.connector);
      const t = (await ctx.connectors.tools(c.id)).find((x) => x.name === a.tool);
      if (!t) throw new Error(`${c.name}에 '${a.tool}' 도구가 없습니다. mcp_list_tools로 찾아보세요.`);
      return { connector: c.name, name: t.name, description: clip(t.description ?? ""), input_schema: t.inputSchema };
    },
  },
  {
    name: "mcp_call",
    description: "커넥터 도구를 부른다. arguments는 mcp_describe에서 본 입력 모양 그대로. 조회 도구는 바로 실행되고, 만들기·바꾸기 도구는 화면에서 허락을 받는다(크레딧이 들면 비용을 보여 줌). 거절되면 다시 부르지 말고 무엇을 바꿀지 묻는다.",
    parameters: { type: "object", properties: { connector: { type: "string" }, tool: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["tool", "arguments"], additionalProperties: false },
    async run(a, ctx) {
      const c = ctx.connectors.find(a.connector);
      const t = (await ctx.connectors.tools(c.id)).find((x) => x.name === a.tool);
      if (!t) throw new Error(`${c.name}에 '${a.tool}' 도구가 없습니다.`);
      let args = a.arguments ?? {};
      if (!READ_ONLY.test(a.tool)) {
        let credits = null;
        const pre = c.practice ? null : costPreviewArgs(t.inputSchema, args);
        if (pre) {
          let preArgs = pre;
          for (let i = 0; i < 3; i++) {
            const r = await ctx.connectors.callAny(c.id, a.tool, preArgs).catch((e) => ({ error: e.message }));
            const declined = applyPresetDecline(preArgs, r);
            if (declined) { preArgs = declined; args = applyPresetDecline(args, r); continue; }
            credits = r?.cost?.credits ?? null; break;
          }
        }
        const ref = args.params?.ref ?? args.ref;
        if (credits == null && typeof ref === "string" && QUOTES.has(ref)) credits = QUOTES.get(ref);
        // 여러 개 한꺼번에(batch): 요청마다 견적 번호가 있으면 더한다
        const refs = Array.isArray(args.requests) ? args.requests.map((q) => q?.params?.ref ?? q?.ref) : [];
        if (credits == null && refs.length && refs.every((x) => QUOTES.has(x))) credits = refs.reduce((s, x) => s + QUOTES.get(x), 0);
        const balance = credits != null ? (await ctx.connectors.callAny(c.id, "balance", {}).catch(() => null))?.credits ?? null : null;
        if (ctx.approval !== "auto" || credits != null || c.practice) {
          const ko = TOOL_KO[a.tool];
          const ans = await ctx.ask("approve", { kind2: "mcp", title: credits != null ? "크레딧을 써서 실행할까요?" : "이 도구를 실행할까요?", connector: c.name, tool: a.tool, tool_ko: ko?.[0] ?? null, practice: !!c.practice, args: clip(JSON.stringify(args, null, 2)), credits, balance,
            context: typeof args.context === "string" ? args.context : null, summary: ko?.[1] ?? (t.description ?? "").replace(/\s+/g, " ").slice(0, 200) });
          if (ans !== "yes") return { approved: false, user_said: ans };
        }
      }
      const res = await ctx.connectors.callAny(c.id, a.tool, args);
      if (/^estimate_/.test(a.tool) && res?.quote_ref && res?.cost?.credits != null) QUOTES.set(res.quote_ref, res.cost.credits);
      const text = JSON.stringify(res);
      return text.length > MAX ? { truncated: true, result: clip(text) } : res;
    },
  },
];
