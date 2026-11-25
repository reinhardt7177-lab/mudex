// 영상 편집 도구(웹판): 브라우저 안 ffmpeg(ffmpeg.wasm)로 자르기·잇기·음악·내보내기·측정을 한다.
// PC판(app/ffmpeg_tools.mjs)과 도구 이름·입력 모양을 같게 둔다. 본체(약 30MB)는 처음 쓸 때 한 번 내려받는다.
import { FFmpeg, FFFSType } from "./vendor/ffmpeg/index.js";

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)$/i, AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i, IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

let ffReady = null;
let logs = [];
function getFF(ctx) {
  if (!ffReady) {
    ctx?.emit({ type: "term", command: "영상 도구(ffmpeg) 준비 · 처음 한 번 약 30MB 내려받기", exit_code: 0, output: "", killed: "" });
    ffReady = (async () => {
      const ff = new FFmpeg();
      ff.on("log", ({ message }) => { logs.push(message); if (logs.length > 600) logs.shift(); });
      await ff.load({ coreURL: `${CORE}/ffmpeg-core.js`, wasmURL: `${CORE}/ffmpeg-core.wasm` });
      return ff;
    })().catch((e) => { ffReady = null; throw new Error(`영상 도구를 불러오지 못했습니다: ${e.message}`); });
  }
  return ffReady;
}

// ffmpeg는 한 번에 하나만 돌린다
let queue = Promise.resolve();
const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

let seq = 0;
const tmpName = (rel) => `f${++seq}${(rel.match(/\.\w+$/) ?? [".bin"])[0].toLowerCase()}`;

// 프로젝트 파일을 ffmpeg에게 보여 준다. 통째로 복사하지 않고(WORKERFS) 필요한 부분만 그때그때 읽어서
// 브라우저가 한 번에 못 올리는 큰 영상(2GB 넘음)도 다룬다. 입력 폴더는 읽기 전용이다.
async function withFiles(ctx, inputs, fn) {
  const ff = await getFF(ctx);
  const dir = `/in${++seq}`;
  const files = [], names = [];
  for (const [i, rel] of inputs.entries()) {
    const name = `i${i}${(rel.match(/\.\w+$/) ?? [".bin"])[0].toLowerCase()}`;
    files.push(new File([await ctx.ws.file(rel)], name)); // 새 File은 내용을 복사하지 않고 가리키기만 한다
    names.push(`${dir}/${name}`);
  }
  await ff.createDir(dir);
  await ff.mount(FFFSType.WORKERFS, { files }, dir);
  try {
    return await fn(ff, names);
  } finally {
    await ff.unmount(dir).catch(() => {});
    await ff.deleteDir(dir).catch(() => {});
  }
}

async function exec(ff, args, ctx) {
  logs = [];
  // 앞서 ffprobe에 준 -v error가 같은 ffmpeg 안에 남으므로 매번 info로 되돌린다(음량 측정 결과가 info로 나온다)
  const code = await ff.exec(["-hide_banner", "-loglevel", "info", "-nostdin", "-y", ...args]);
  ctx?.emit({ type: "term", command: `ffmpeg ${args.join(" ")}`, exit_code: code, output: logs.slice(-8).join("\n"), killed: "" });
  if (code !== 0) throw new Error(`ffmpeg 실패(${code}): ${logs.slice(-12).join("\n").slice(-800)}`);
  return logs.join("\n");
}

// 결과를 프로젝트에 쓰고 화면에 알린다
async function saveOut(ff, name, rel, ctx) {
  const data = await ff.readFile(name);
  await ff.deleteFile(name).catch(() => {});
  await ctx.ws.write(rel, data);
  ctx.emit({ type: "file_changed", path: rel });
  return data.length;
}

async function probeNamed(ff, name, rel) {
  const out = `p${++seq}.json`; // 입력 폴더는 읽기 전용이라 결과는 바깥에 쓴다
  await ff.ffprobe(["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", name, "-o", out]);
  const j = JSON.parse(new TextDecoder().decode(await ff.readFile(out)));
  await ff.deleteFile(out).catch(() => {});
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    file: rel,
    // 영상이면 영상 스트림 길이를 쓴다(컨테이너 길이는 AAC 꼬리만큼 길게 나온다)
    duration: Number(Number(v?.duration ?? j.format?.duration ?? 0).toFixed(3)),
    width: v?.width ?? null, height: v?.height ?? null,
    fps: v && d ? Number((n / d).toFixed(3)) : null,
    has_audio: (j.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}
const probe = (ctx, rel) => serial(() => withFiles(ctx, [rel], (ff, [n]) => probeNamed(ff, n, rel)));

async function loudnessNamed(ff, name, ctx) {
  const log = await exec(ff, ["-i", name, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], ctx);
  const m = log.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  return { integrated_lufs: Number(j.input_i), true_peak_db: Number(j.input_tp), lra: Number(j.input_lra) };
}

const H264 = ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "192k"];

export const VIDEO_TOOLS = [
  {
    name: "list_clips",
    description: "프로젝트의 영상·음악·사진 목록과 영상·음악의 길이(초), 해상도, 소리 유무를 보여 준다. out/(결과)와 tmp/(중간 파일)는 뺀다.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run(a, ctx) {
      const files = (await ctx.ws.list("", { skip: [".mudex", "out", "tmp", "review", "node_modules", ".git"] })).filter((f) => !f.dir).map((f) => f.path).sort();
      const result = { videos: [], music: [], images: [] };
      for (const f of files) {
        if (VIDEO_EXT.test(f)) result.videos.push(await probe(ctx, f));
        else if (AUDIO_EXT.test(f)) result.music.push(await probe(ctx, f));
        else if (IMAGE_EXT.test(f)) result.images.push(f);
      }
      return result;
    },
  },
  {
    name: "probe",
    description: "영상·음악 파일 하나의 길이(초), 해상도, fps, 소리 유무를 잰다.",
    parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false },
    run: (a, ctx) => probe(ctx, a.file),
  },
  {
    name: "trim",
    description: "영상의 start초부터 end초까지만 잘라 새 파일로 저장한다. 길이는 프레임 단위로 맞춰진다. 브라우저 안에서 다시 인코딩하므로 1080p는 몇십 초 걸린다.",
    parameters: { type: "object", properties: { input: { type: "string" }, start: { type: "number" }, end: { type: "number" }, output: { type: "string", description: "예: tmp/clip1_cut.mp4" } }, required: ["input", "start", "end", "output"], additionalProperties: false },
    run: (a, ctx) => serial(() => withFiles(ctx, [a.input], async (ff, [n]) => {
      if (!(a.end > a.start)) throw new Error("end는 start보다 커야 합니다.");
      const info = await probeNamed(ff, n, a.input);
      const fps = info.fps || 30;
      const frames = Math.max(1, Math.round((a.end - a.start) * fps));
      const dur = (frames / fps).toFixed(6);
      const out = tmpName(a.output);
      const args = ["-ss", String(a.start), "-i", n, "-frames:v", String(frames), ...H264];
      if (info.has_audio) args.push("-af", `apad,atrim=0:${dur},asetpts=PTS-STARTPTS`, ...AAC);
      await exec(ff, [...args, out], ctx);
      const r = await probeNamed(ff, out, a.output);
      await saveOut(ff, out, a.output, ctx);
      return r;
    })),
  },
  {
    name: "concat",
    description: "영상 여러 개를 순서대로 이어 붙인다. 모두 같은 크기·fps·소리 있음이면 다시 인코딩 없이 빠르게 붙이고, 다르면 첫 영상 기준(또는 width/height/fps 지정)으로 맞춰 다시 인코딩한다. 소리 없는 영상에는 무음을 채운다.",
    parameters: { type: "object", properties: { inputs: { type: "array", items: { type: "string" }, minItems: 2 }, output: { type: "string" }, width: { type: "integer" }, height: { type: "integer" }, fps: { type: "number" } }, required: ["inputs", "output"], additionalProperties: false },
    run: (a, ctx) => serial(() => withFiles(ctx, a.inputs, async (ff, names) => {
      const infos = [];
      for (const [i, n] of names.entries()) infos.push(await probeNamed(ff, n, a.inputs[i]));
      const out = tmpName(a.output);
      const same = !a.width && !a.height && !a.fps && infos.every((x) => x.width === infos[0].width && x.height === infos[0].height && x.fps === infos[0].fps && x.has_audio);
      let copied = false;
      if (same) {
        // 빠른 길: 다시 인코딩 없이 붙이기
        await ff.writeFile("list.txt", new TextEncoder().encode(names.map((n) => `file '${n}'`).join("\n")));
        try { await exec(ff, ["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "-movflags", "+faststart", out], ctx); copied = true; } catch {}
        await ff.deleteFile("list.txt").catch(() => {});
      }
      if (!copied) {
        const W = a.width ?? infos[0].width, H = a.height ?? infos[0].height, FPS = a.fps ?? (infos[0].fps || 30);
        const args = [];
        for (const n of names) args.push("-i", n);
        let extra = names.length;
        const parts = [];
        const filters = infos.map((info, i) => {
          let audio = `${i}:a`;
          if (!info.has_audio) { args.push("-f", "lavfi", "-t", String(info.duration), "-i", "anullsrc=r=48000:cl=stereo"); audio = `${extra++}:a`; }
          parts.push(`[v${i}][a${i}]`);
          return `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}];` +
            `[${audio}]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${info.duration},asetpts=PTS-STARTPTS[a${i}]`;
        });
        const fc = filters.join(";") + ";" + parts.join("") + `concat=n=${infos.length}:v=1:a=1[v][a]`;
        await exec(ff, [...args, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...H264, ...AAC, out], ctx);
      }
      const r = await probeNamed(ff, out, a.output);
      await saveOut(ff, out, a.output, ctx);
      return { ...r, reencoded: !copied };
    })),
  },
  {
    name: "add_music",
    description: "영상에 음악을 얹는다(영상은 다시 인코딩하지 않아 빠르다). 음악은 영상 길이에 맞춰 자르고 끝에서 fade_out초 동안 줄인다. keep_original_audio가 true면 원래 소리와 섞는다.",
    parameters: {
      type: "object",
      properties: {
        video: { type: "string" }, music: { type: "string" }, output: { type: "string" },
        music_start: { type: "number", description: "음악을 몇 초 지점부터 쓸지. 기본 0" },
        music_volume: { type: "number", description: "1.0이 원래 크기. 기본 1.0" },
        fade_out: { type: "number", description: "끝 페이드아웃 초. 기본 1.5" },
        keep_original_audio: { type: "boolean" },
        original_volume: { type: "number", description: "원래 소리를 섞을 때 크기. 기본 0.5" },
      },
      required: ["video", "music", "output"], additionalProperties: false,
    },
    run: (a, ctx) => serial(() => withFiles(ctx, [a.video, a.music], async (ff, [vn, mn]) => {
      const v = await probeNamed(ff, vn, a.video);
      const D = v.duration, fade = Math.min(a.fade_out ?? 1.5, D), ss = a.music_start ?? 0;
      const m = `[1:a]atrim=start=${ss}:duration=${D},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${a.music_volume ?? 1},afade=t=out:st=${(D - fade).toFixed(3)}:d=${fade}`;
      const fc = a.keep_original_audio && v.has_audio
        ? `${m}[m];[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${a.original_volume ?? 0.5}[o];[o][m]amix=inputs=2:duration=first:normalize=0[a]`
        : `${m}[a]`;
      const out = tmpName(a.output);
      await exec(ff, ["-i", vn, "-i", mn, "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", ...AAC, "-t", String(D), out], ctx);
      const r = await probeNamed(ff, out, a.output);
      await saveOut(ff, out, a.output, ctx);
      return r;
    })),
  },
  {
    name: "export_final",
    description: "마지막 내보내기. duration을 주면 길이를 프레임 단위로 맞춘다(모자라면 마지막 장면을 늘리고 넘치면 자른다). 음량은 -14 LUFS, 피크는 -1dB 아래로 맞추고 MP4로 저장한다. output은 out/ 아래에 둔다.",
    parameters: { type: "object", properties: { input: { type: "string" }, output: { type: "string", description: "예: out/final.mp4" }, duration: { type: "number", description: "목표 길이(초)" }, target_lufs: { type: "number" } }, required: ["input", "output"], additionalProperties: false },
    run: (a, ctx) => serial(() => withFiles(ctx, [a.input], async (ff, [n]) => {
      const I = a.target_lufs ?? -14;
      const info = await probeNamed(ff, n, a.input);
      const fps = info.fps || 30;
      const frames = Math.round((a.duration ?? info.duration) * fps);
      const dur = (frames / fps).toFixed(6);
      const out = tmpName(a.output);
      let loud = null;
      // 소리 길이 완전히 무음이면(재면 -inf) 음량을 맞출 수 없으니 소리 길을 빼고 영상만 내보낸다
      const L0 = info.has_audio ? await loudnessNamed(ff, n, ctx) : null;
      if (L0 && !Number.isFinite(L0.integrated_lufs)) info.has_audio = false;
      if (info.has_audio) {
        // 음량: 이득을 올리고 리미터로 피크를 누른 뒤, 다시 재서 한 번 더 보정한다(소리만 다루므로 빠르다)
        let gain = I - (L0?.integrated_lufs ?? I);
        for (let pass = 0; pass < 3; pass++) {
          await exec(ff, ["-i", n, "-vn", "-af", `apad,atrim=0:${dur},volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:level=0:attack=5:release=50`, "-ar", "48000", "-ac", "2", "loud.wav"], ctx);
          const got = (await loudnessNamed(ff, "loud.wav", ctx))?.integrated_lufs ?? I;
          if (Math.abs(got - I) <= 0.2) break;
          gain += I - got;
        }
      }
      const longer = frames > Math.round(info.duration * fps) + 1;
      const audioIn = info.has_audio ? ["-i", "loud.wav", "-map", "0:v", "-map", "1:a", ...AAC] : ["-map", "0:v"];
      // 길이를 늘려야 할 때만 영상을 다시 인코딩한다(아니면 그대로 복사해 빠르게)
      const vargs = longer ? ["-vf", "tpad=stop_mode=clone:stop_duration=30", "-frames:v", String(frames), ...H264] : ["-c:v", "copy", "-frames:v", String(frames)];
      await exec(ff, ["-i", n, ...audioIn, ...vargs, "-movflags", "+faststart", "-t", dur, out], ctx);
      await ff.deleteFile("loud.wav").catch(() => {});
      const r = await probeNamed(ff, out, a.output);
      if (r) loud = info.has_audio ? await loudnessNamed(ff, out, ctx) : null;
      const size = await saveOut(ff, out, a.output, ctx);
      return { ...r, size, loudness: loud };
    })),
  },
  {
    name: "measure",
    description: "파일의 실제 길이와 음량(LUFS, 트루피크)을 잰다. 작업이 끝나면 결과 파일을 재서 지시대로 됐는지 확인한다.",
    parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false },
    run: (a, ctx) => serial(() => withFiles(ctx, [a.file], async (ff, [n]) => {
      const info = await probeNamed(ff, n, a.file);
      return { ...info, loudness: info.has_audio ? await loudnessNamed(ff, n, ctx) : null };
    })),
  },
  {
    name: "run_ffmpeg",
    description: "ffmpeg 명령을 직접 실행한다(브라우저 안 ffmpeg). 위 도구로 안 되는 편집(로고 가리기 delogo·덮기, 그림 얹기 overlay, 글자, 색, 속도, 크기 바꾸기 등)에 쓴다. args에서 입력 파일은 {0}, {1}…(inputs 순서), 결과 파일은 {out}으로 쓴다. 예: inputs [\"a.mp4\",\"logo.png\"], args [\"-i\",\"{0}\",\"-i\",\"{1}\",\"-filter_complex\",\"[0:v]delogo=x=1700:y=30:w=200:h=80[v];[v][1:v]overlay=W-w-40:40:enable='gte(t,120)'\",\"-c:a\",\"copy\",\"{out}\"]. 영상을 다시 인코딩하면 1080p에서 1분에 몇 분 걸린다.",
    parameters: { type: "object", properties: { inputs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 }, args: { type: "array", items: { type: "string" }, minItems: 1 }, output: { type: "string", description: "예: out/edited.mp4" } }, required: ["inputs", "args", "output"], additionalProperties: false },
    run: (a, ctx) => serial(() => withFiles(ctx, a.inputs, async (ff, names) => {
      if (!a.args.includes("{out}")) throw new Error("args에 결과 파일 자리 {out}이 없습니다.");
      const out = tmpName(a.output);
      const args = a.args.map((x) => x.replace(/\{(\d+|out)\}/g, (m, k) => (k === "out" ? out : names[Number(k)] ?? m)));
      // 브라우저 안 인코딩은 느리므로 가장 빠른 설정을 기본으로(사용자가 정하면 그 값을 쓴다)
      if (args.includes("libx264") && !args.includes("-preset")) args.splice(args.indexOf(out), 0, "-preset", "ultrafast");
      await exec(ff, args, ctx);
      const r = await probeNamed(ff, out, a.output).catch(() => ({ file: a.output }));
      const size = await saveOut(ff, out, a.output, ctx);
      return { ...r, size };
    })),
  },
];
