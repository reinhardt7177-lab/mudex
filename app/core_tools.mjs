// 기본 도구: 코덱스·클로드 코드처럼 프로젝트 폴더 안에서 파일을 보고·읽고·쓰고·고치고, 명령을 실행한다.
// 모든 경로는 프로젝트 폴더 안으로 묶는다(Workspace.p). 명령은 승인 모드에 따라 실행 전에 묻는다.
// ctx: { emit, ask, approval: "ask"|"auto", session: {}, code, relay }
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
const SKIP_DIRS = new Set([".mudex", "node_modules", ".git", "__pycache__"]);
const TEXT_EXT = /\.(txt|md|html?|css|js|mjs|cjs|ts|tsx|jsx|json|csv|tsv|py|bat|ps1|sh|xml|svg|yml|yaml|toml|ini|srt|vtt|log)$/i;
const MAX_TOOL_TEXT = 12000;
const clip = (s, n = MAX_TOOL_TEXT) => (s.length > n ? s.slice(0, n / 2) + `\n…(${s.length - n}자 줄임)…\n` + s.slice(-n / 2) : s);

// 명령 실행: PowerShell, 프로젝트 폴더에서, 동봉한 bin(ffmpeg·node)을 PATH 앞에 둔다
function runShell(command, cwd, timeoutMs, signal) {
  return new Promise((resolve) => {
    const pre = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ";
    const env = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH ?? ""}` };
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", pre + command], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let killed = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const kill = (why) => { killed = why; try { spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }); } catch {} };
    const timer = setTimeout(() => kill(`${timeoutMs / 1000}초가 지나 멈췄습니다`), timeoutMs);
    signal?.addEventListener("abort", () => kill("사용자가 멈췄습니다"), { once: true });
    p.on("close", (code) => { clearTimeout(timer); resolve({ exit_code: code, output: out, killed }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ exit_code: -1, output: e.message, killed }); });
  });
}

function walk(ws, rel, depth, out, limit) {
  const abs = ws.p(rel || ".");
  for (const d of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))) {
    if (out.length >= limit) return;
    if (SKIP_DIRS.has(d.name)) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      out.push(`${r}/`);
      if (depth > 1) walk(ws, r, depth - 1, out, limit);
    } else {
      const size = fs.statSync(path.join(abs, d.name)).size;
      out.push(`${r}  (${size < 1024 ? size + "B" : size < 1048576 ? (size / 1024).toFixed(0) + "KB" : (size / 1048576).toFixed(1) + "MB"})`);
    }
  }
}

export const CORE_TOOLS = [
  {
    name: "update_plan",
    description: "할 일 목록을 화면 아래에 보여 준다. 여러 단계 일을 시작할 때 3~6단계로 세우고, 단계가 끝날 때마다 done_count를 올려 다시 부른다.",
    parameters: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 }, done_count: { type: "integer", minimum: 0 } },
      required: ["steps", "done_count"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) { ctx.emit({ type: "plan", steps: a.steps, done: a.done_count }); return { ok: true }; },
  },
  {
    name: "list_files",
    description: "프로젝트 폴더의 파일과 폴더를 크기와 함께 보여 준다. path는 프로젝트 폴더 기준(비우면 맨 위).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: 6, description: "기본 3" } },
      additionalProperties: false,
    },
    async run(ws, a) {
      const out = [];
      walk(ws, (a.path ?? "").replace(/^\.?\/?/, "").replace(/\/$/, ""), a.depth ?? 3, out, 400);
      return { files: out, note: out.length >= 400 ? "400개까지만 보여 줌" : undefined };
    },
  },
  {
    name: "read_file",
    description: "글자로 된 파일을 읽는다(코드·HTML·CSV·자막 등). 영상·사진 같은 바이너리는 크기만 알려 준다. offset·limit은 줄 번호(1부터).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, offset: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 3000 } },
      required: ["path"],
      additionalProperties: false,
    },
    async run(ws, a) {
      const abs = ws.p(a.path);
      const st = fs.statSync(abs);
      if (!TEXT_EXT.test(abs) && st.size > 0) {
        const head = fs.readFileSync(abs).subarray(0, 2048);
        if (head.includes(0)) return { path: a.path, binary: true, size: st.size, note: "글자 파일이 아닙니다. 영상·음악이면 probe, 사진이면 화면에서 보여 주세요." };
      }
      const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
      const from = (a.offset ?? 1) - 1;
      const part = lines.slice(from, from + (a.limit ?? 2000));
      return { path: a.path, total_lines: lines.length, from: from + 1, text: clip(part.map((l, i) => `${from + i + 1}\t${l}`).join("\n"), 40000) };
    },
  },
  {
    name: "write_file",
    description: "파일을 새로 만들거나 통째로 덮어쓴다. 폴더가 없으면 만든다. 이미 있는 파일 일부만 바꿀 때는 edit_file을 쓴다.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const abs = ws.outPath(a.path);
      const existed = fs.existsSync(abs);
      const before = existed ? fs.readFileSync(abs, "utf8").split(/\r?\n/).length : 0;
      fs.writeFileSync(abs, a.content);
      const after = a.content.split(/\r?\n/).length;
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, created: !existed, lines: after, lines_before: before };
    },
  },
  {
    name: "edit_file",
    description: "파일의 일부를 바꾼다. old_text는 파일에 그대로(공백·줄바꿈까지) 있어야 하고 한 군데만 있어야 한다(여러 곳이면 replace_all).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } },
      required: ["path", "old_text", "new_text"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const abs = ws.p(a.path);
      const src = fs.readFileSync(abs, "utf8");
      const n = src.split(a.old_text).length - 1;
      if (n === 0) throw new Error("old_text를 파일에서 찾지 못했습니다. read_file로 지금 내용을 다시 보세요.");
      if (n > 1 && !a.replace_all) throw new Error(`old_text가 ${n}군데 있습니다. 더 길게 잡거나 replace_all을 쓰세요.`);
      fs.writeFileSync(abs, a.replace_all ? src.split(a.old_text).join(a.new_text) : src.replace(a.old_text, () => a.new_text));
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, replaced: a.replace_all ? n : 1 };
    },
  },
  {
    name: "run_command",
    description: "프로젝트 폴더에서 PowerShell 명령을 실행하고 출력을 돌려준다. ffmpeg·ffprobe·node가 준비되어 있다(python은 PC에 있으면 됨). 오래 걸리면 timeout_seconds를 늘린다. 승인 모드가 '물어보고 하기'면 실행 전에 화면에서 허락을 받는다. 파일 읽기·쓰기는 이 도구 말고 전용 도구를 쓴다.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        why: { type: "string", description: "이 명령으로 무엇을 하려는지 한 줄(허락 카드에 보임)" },
        timeout_seconds: { type: "integer", minimum: 5, maximum: 900, description: "기본 120" },
      },
      required: ["command", "why"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      if (ctx.approval !== "auto" && !ctx.session.commandsOk) {
        const ans = await ctx.ask("approve", { kind2: "command", title: "이 명령을 실행할까요?", why: a.why, command: a.command, cwd: ws.dir });
        if (ans === "always") ctx.session.commandsOk = true;
        else if (ans !== "yes") return { approved: false, user_said: ans };
      }
      const r = await runShell(a.command, ws.dir, (a.timeout_seconds ?? 120) * 1000, ctx.signal);
      ctx.emit({ type: "term", command: a.command, exit_code: r.exit_code, output: clip(r.output, 20000), killed: r.killed });
      return { exit_code: r.exit_code, output: clip(r.output), stopped: r.killed || undefined };
    },
  },
  {
    name: "download_file",
    description: "https 주소의 파일을 프로젝트 폴더로 내려받는다(예: MCP 생성 결과 영상·사진).",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, path: { type: "string", description: "저장할 곳, 예: clips/scene1.mp4" } },
      required: ["url", "path"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      if (!/^https:\/\//i.test(a.url)) throw new Error("https 주소만 받을 수 있습니다.");
      const r = await fetch(a.url, { signal: ctx.signal });
      if (!r.ok) throw new Error(`내려받기 실패 ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(ws.outPath(a.path), buf);
      ctx.emit({ type: "file_changed", path: a.path });
      return { path: a.path, size: buf.length, content_type: r.headers.get("content-type") };
    },
  },
  {
    name: "upload_file",
    description: "프로젝트 폴더의 파일을 미리 받은 업로드 주소(presigned URL)로 PUT 한다. MCP 도구가 '이 주소로 올리라'고 할 때 쓴다(예: 힉스필드 media_upload → upload_file → media_confirm).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, url: { type: "string" }, content_type: { type: "string" } },
      required: ["path", "url"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      if (!/^https:\/\//i.test(a.url)) throw new Error("https 주소에만 올릴 수 있습니다.");
      const body = fs.readFileSync(ws.p(a.path));
      const r = await fetch(a.url, { method: "PUT", headers: a.content_type ? { "Content-Type": a.content_type } : {}, body, signal: ctx.signal });
      if (!r.ok) throw new Error(`올리기 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return { ok: true, status: r.status, size: body.length };
    },
  },
  {
    name: "make_image",
    description: "그림을 그린다(무덱스 자체 이미지 생성, 강사 API 사용, 힉스필드 크레딧 0). 영어 프롬프트로 장면·빛·구도를 구체적으로. 결과는 path_prefix_1.png … 로 저장.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        path_prefix: { type: "string", description: "예: images/mudball" },
        count: { type: "integer", minimum: 1, maximum: 4, description: "기본 1" },
        size: { type: "string", enum: ["1536x1024", "1024x1024", "1024x1536"], description: "기본 1536x1024(가로)" },
        quality: { type: "string", enum: ["low", "medium", "high"], description: "기본 medium" },
      },
      required: ["prompt", "path_prefix"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const r = await fetch(`${ctx.relay}/v1/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.code}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1-mini", prompt: a.prompt, n: a.count ?? 1, size: a.size ?? "1536x1024", quality: a.quality ?? "medium" }),
        signal: ctx.signal,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? JSON.stringify(j).slice(0, 300));
      const files = j.data.map((d, i) => {
        const rel = `${a.path_prefix.replace(/\.png$/i, "")}_${i + 1}.png`;
        fs.writeFileSync(ws.outPath(rel), Buffer.from(d.b64_json, "base64"));
        return rel;
      });
      if (j.mudex) ctx.emit({ type: "cost", cost_usd: j.mudex.cost_usd, remaining_usd: j.mudex.remaining_usd });
      files.forEach((f) => ctx.emit({ type: "file_changed", path: f }));
      return { files, cost_usd: j.mudex?.cost_usd };
    },
  },
  {
    name: "ask_user",
    description: "사용자에게 고르게 한다. files를 주면 사진·영상을 보여 주고 하나를 고르게, options를 주면 글자 버튼으로 고르게 한다. 고른 값(파일 경로나 보기 글)을 돌려주고, 사용자가 다른 말을 하면 그 말을 돌려준다.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        files: { type: "array", items: { type: "string" }, maxItems: 8 },
        options: { type: "array", items: { type: "string" }, maxItems: 6 },
      },
      required: ["question"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      for (const f of a.files ?? []) ws.p(f);
      return ctx.ask("pick", { question: a.question, files: a.files ?? [], options: a.options ?? [] });
    },
  },
];
