// 생성·대화형 도구: 할 일 목록, 키프레임(OpenAI 이미지), 사용자에게 고르게 하기,
// 클링 영상 생성(힉스필드, 매번 허락), 8fps 검수 시트.
// ctx: { emit(event), ask(kind, payload) → Promise<answer>, code, relay, hf }
import fs from "node:fs";
import path from "node:path";
import { probe } from "./ffmpeg_tools.mjs";

const VIDEO_MODELS = {
  kling3_0: { label: "Kling 3.0", params: (a) => ({ duration: a.duration, mode: "std", sound: "off" }) },
  kling2_6: { label: "Kling 2.6", params: (a) => ({ duration: a.duration >= 8 ? 10 : 5, sound: false }) },
  kling3_0_turbo: { label: "Kling 3.0 Turbo", params: (a) => ({ duration: a.duration, resolution: "720p" }) },
};

// 응답 어디에 있든 영상 주소와 작업 ID를 찾는다(힉스필드 응답 모양이 도구마다 다르다)
function findAll(obj, test, out = []) {
  if (obj == null) return out;
  if (typeof obj === "string") { if (test(obj)) out.push(obj); return out; }
  if (typeof obj === "object") for (const v of Object.values(obj)) findAll(v, test, out);
  return out;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isVideoUrl = (s) => /^https?:\/\/\S+\.(mp4|mov|webm)(\?|$)/i.test(s);
function findJobIds(obj) {
  const ids = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && UUID.test(v) && /job|^id$/i.test(k)) ids.push(v);
      else walk(v);
    }
  };
  walk(obj);
  return [...new Set(ids)];
}
const statusOf = (obj) => findAll(obj, (s) => /^(completed|succeeded|failed|error|cancel+ed|nsfw|ip_detected|queued|in_progress|processing|pending|running)$/i.test(s))[0]?.toLowerCase();

// 힉스필드 generate_video는 비용 대신 "프리셋을 쓸까요?" 추천을 돌려줄 때가 있다.
// 무덱스는 프롬프트 그대로 만들므로 추천을 거절하고 다시 부른다. 무료 체험(unlim)은 쓰지 않고 크레딧으로 낸다.
async function hfGenerate(hf, params, extra = {}) {
  let p = { use_unlim: false, ...params };
  for (let i = 0; i < 3; i++) {
    const r = await hf.call("generate_video", { params: p, ...extra });
    const retry = r?.notice?.data?.retry_literal_with;
    if (r?.notice?.type === "preset_recommendation" && retry) { p = { ...p, ...retry }; continue; }
    return { result: r, params: p };
  }
  throw new Error("힉스필드가 프리셋 추천만 돌려줍니다. 프롬프트를 조금 바꿔 다시 해 주세요.");
}

export const GEN_TOOLS = [
  {
    name: "set_plan",
    description: "할 일 목록을 화면 아래에 보여 준다. 작업을 시작할 때 3~6단계로 세우고, 단계가 끝날 때마다 done_count를 올려 다시 부른다.",
    parameters: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 }, done_count: { type: "integer", minimum: 0 } },
      required: ["steps", "done_count"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      ctx.emit({ type: "plan", steps: a.steps, done: a.done_count });
      return { ok: true };
    },
  },
  {
    name: "make_keyframes",
    description: "첫 장면(키프레임) 사진을 그린다. 힉스필드 크레딧을 쓰지 않는다(강사 API). 프롬프트는 영어로 구체적으로(장면, 빛, 렌즈, 구도). 결과는 keyframes/ 아래 png.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "파일 이름 앞부분(영문·숫자), 예: mudball" },
        prompt: { type: "string" },
        count: { type: "integer", minimum: 1, maximum: 4, description: "기본 4" },
        quality: { type: "string", enum: ["low", "medium", "high"], description: "기본 medium" },
      },
      required: ["name", "prompt"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const r = await fetch(`${ctx.relay}/v1/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ctx.code}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-image-1-mini", prompt: a.prompt, n: a.count ?? 4, size: "1536x1024", quality: a.quality ?? "medium" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? JSON.stringify(j).slice(0, 300));
      const files = [];
      const safe = a.name.replace(/[^\w-]/g, "_");
      j.data.forEach((d, i) => {
        const rel = `keyframes/${safe}_${Date.now().toString(36)}_${i + 1}.png`;
        fs.writeFileSync(ws.outPath(rel), Buffer.from(d.b64_json, "base64"));
        files.push(rel);
      });
      if (j.mudex) ctx.emit({ type: "cost", cost_usd: j.mudex.cost_usd, remaining_usd: j.mudex.remaining_usd });
      return { files, cost_usd: j.mudex?.cost_usd };
    },
  },
  {
    name: "ask_pick",
    description: "사진이나 영상 여러 개를 화면에 보여 주고 사용자가 하나를 고르게 한다. 고른 파일 경로를 돌려준다(사용자가 다른 말을 하면 그 말을 돌려준다).",
    parameters: {
      type: "object",
      properties: { question: { type: "string" }, files: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 } },
      required: ["question", "files"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      for (const f of a.files) ws.p(f);
      const ans = await ctx.ask("pick", { question: a.question, files: a.files });
      return ans;
    },
  },
  {
    name: "generate_video",
    description: "힉스필드(클링)로 영상을 생성한다. 연수생 크레딧을 쓰므로 실행 전에 화면에서 비용을 보여 주고 허락을 받는다(거절되면 그대로 멈추고 이유를 묻는다). start_image는 작업 폴더의 사진. 결과는 clips/ 아래 mp4.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "파일 이름(영문·숫자), 예: mudball_drop" },
        prompt: { type: "string", description: "영어로, 움직임과 카메라 중심" },
        start_image: { type: "string" },
        duration: { type: "integer", minimum: 3, maximum: 10, description: "초. 기본 5" },
        model: { type: "string", enum: Object.keys(VIDEO_MODELS), description: "기본 kling3_0" },
      },
      required: ["name", "prompt", "start_image"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      if (!ctx.hf.loggedIn) throw new Error("힉스필드에 로그인하지 않았습니다. 왼쪽 아래에서 로그인해 달라고 안내하세요.");
      const model = VIDEO_MODELS[a.model ?? "kling3_0"] ? (a.model ?? "kling3_0") : "kling3_0";
      const spec = { duration: a.duration ?? 5 };
      const mediaId = await ctx.hf.upload(ws.p(a.start_image));
      const params = { model, prompt: a.prompt, aspect_ratio: "16:9", medias: [{ role: "start_image", value: mediaId }], ...VIDEO_MODELS[model].params(spec) };
      const pre = await hfGenerate(ctx.hf, { ...params, get_cost: true });
      const cost = pre.result?.cost?.credits;
      if (cost == null) throw new Error("비용을 미리 알 수 없어 멈췄습니다: " + JSON.stringify(pre.result).slice(0, 200));
      const { get_cost, ...finalParams } = pre.params;
      const bal = await ctx.hf.balance().catch(() => ({}));
      const ans = await ctx.ask("approve", {
        title: "영상을 생성할까요?",
        model: VIDEO_MODELS[model].label, duration: params.duration, quality: params.mode ?? params.resolution ?? "기본",
        credits: cost, balance: bal.credits, prompt: a.prompt, start_image: a.start_image,
      });
      if (ans !== "yes") return { approved: false, user_said: ans };

      const gid = `g${Date.now().toString(36)}`;
      ctx.emit({ type: "gen", id: gid, name: a.name, label: `${VIDEO_MODELS[model].label} · ${params.duration}초`, credits: cost, state: "submitted", thumb: a.start_image });
      const { result: sub } = await hfGenerate(ctx.hf, finalParams, { context: "교원 연수 실습용 장면 생성" });
      const jobId = findJobIds(sub)[0];
      if (!jobId) throw new Error("작업 번호를 받지 못했습니다: " + JSON.stringify(sub).slice(0, 300));
      const t0 = Date.now();
      let url = findAll(sub, isVideoUrl)[0];
      while (!url) {
        if (Date.now() - t0 > 12 * 60 * 1000) throw new Error("12분이 지나도 생성이 끝나지 않았습니다. 힉스필드 사이트에서 확인해 주세요. 작업 번호 " + jobId);
        const st = await ctx.hf.call("job_status", { jobId, sync: true });
        const s = statusOf(st);
        url = findAll(st, isVideoUrl)[0];
        if (!url && /failed|error|cancel|nsfw|ip_detected/.test(s ?? "")) throw new Error(`생성 실패(${s}): ${JSON.stringify(st).slice(0, 300)}`);
        ctx.emit({ type: "gen", id: gid, state: "running", elapsed: Math.round((Date.now() - t0) / 1000) });
      }
      const rel = `clips/${a.name.replace(/[^\w-]/g, "_")}_${Date.now().toString(36)}.mp4`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.writeFileSync(ws.outPath(rel), buf);
      ctx.emit({ type: "gen", id: gid, state: "done", file: rel });
      return { file: rel, ...(await probe(ws, rel)), credits_used: cost };
    },
  },
  {
    name: "review_sheet",
    description: "영상의 start초부터 seconds초 동안을 1초 8장(8fps)으로 쪼개 화면에 검수 시트로 보여 준다. 생성한 컷은 착지·전환 순간을 이걸로 확인하게 한다.",
    parameters: {
      type: "object",
      properties: { file: { type: "string" }, start: { type: "number" }, seconds: { type: "number", description: "기본 1, 최대 3" } },
      required: ["file", "start"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const sec = Math.min(a.seconds ?? 1, 3);
      const base = `review/${path.basename(a.file, path.extname(a.file))}_${String(a.start).replace(".", "_")}`;
      const dir = ws.outPath(base + "/x");
      const outDir = path.dirname(dir);
      await ws.ff(["-ss", String(a.start), "-t", String(sec), "-i", ws.p(a.file), "-vf", "fps=8,scale=480:-2", "-q:v", "4", path.join(outDir, "f_%02d.jpg")]);
      const frames = fs.readdirSync(outDir).filter((f) => f.endsWith(".jpg")).sort()
        .map((f, i) => ({ file: `${base}/${f}`, t: Number((a.start + i / 8).toFixed(3)) }));
      ctx.emit({ type: "sheet", file: a.file, frames });
      return { frames: frames.length, note: "검수 시트를 화면에 띄웠다. 사용자가 보고 판단하게 한다." };
    },
  },
];
