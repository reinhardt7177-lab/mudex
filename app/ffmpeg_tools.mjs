// 편집 에이전트가 쓰는 ffmpeg 도구들. 모든 경로는 작업 폴더 안으로 묶는다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// 동봉한 ffmpeg(app/../bin)를 먼저 찾고, 없으면 PATH의 ffmpeg를 쓴다.
function findBin(name) {
  if (process.env[`MUDEX_${name.toUpperCase()}`]) return process.env[`MUDEX_${name.toUpperCase()}`];
  const bundled = path.join(APP_DIR, "..", "bin", `${name}.exe`);
  return fs.existsSync(bundled) ? bundled : name;
}
const FFMPEG = findBin("ffmpeg");
const FFPROBE = findBin("ffprobe");

function run(bin, args, onLog) {
  return new Promise((resolve, reject) => {
    onLog?.(`$ ${path.basename(bin)} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
    const p = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${path.basename(bin)} 실패(${code}): ${err.slice(-600)}`))));
  });
}

export class Workspace {
  constructor(dir, onLog) {
    this.dir = path.resolve(dir);
    this.onLog = onLog;
    fs.mkdirSync(path.join(this.dir, "out"), { recursive: true });
  }
  // 작업 폴더 밖으로 나가는 경로는 거절
  p(rel) {
    const abs = path.resolve(this.dir, rel);
    if (abs !== this.dir && !abs.startsWith(this.dir + path.sep)) throw new Error(`작업 폴더 밖 경로는 쓸 수 없습니다: ${rel}`);
    return abs;
  }
  outPath(rel) {
    const abs = this.p(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return abs;
  }
  ff(args) { return run(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], this.onLog); }
}

export async function probe(ws, file) {
  const { out } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", ws.p(file)]);
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === "video");
  const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    file,
    // 영상이면 영상 스트림 길이를 쓴다(컨테이너 길이는 AAC 꼬리만큼 길게 나온다)
    duration: Number(Number(v?.duration ?? j.format.duration).toFixed(3)),
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: v ? Number((n / d).toFixed(3)) : null,
    has_audio: j.streams.some((s) => s.codec_type === "audio"),
  };
}

export async function measureLoudness(ws, file) {
  const { err } = await ws.ff(["-i", ws.p(file), "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
  const j = JSON.parse(err.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]);
  return { integrated_lufs: Number(j.input_i), true_peak_db: Number(j.input_tp), lra: Number(j.input_lra), thresh: Number(j.input_thresh) };
}

// ---- 모델에게 주는 도구 ----
export const TOOLS = [
  {
    name: "list_clips",
    description: "작업 폴더의 영상·음악·사진 목록과 영상·음악의 길이(초), 해상도, 소리 유무를 보여 준다. out/(결과)와 tmp/(중간 파일)는 뺀다.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run(ws) {
      const skip = ["out", "tmp", "review", ".mudex"].map((d) => d + path.sep);
      const files = fs.readdirSync(ws.dir, { recursive: true }).map(String).filter((f) => !skip.some((d) => f.startsWith(d)));
      const result = { videos: [], music: [], images: [] };
      for (const f of files.sort()) {
        const ext = path.extname(f).toLowerCase();
        const rel = f.split(path.sep).join("/");
        if (VIDEO_EXT.has(ext)) result.videos.push(await probe(ws, rel));
        else if (AUDIO_EXT.has(ext)) result.music.push(await probe(ws, rel));
        else if (IMAGE_EXT.has(ext)) result.images.push(rel);
      }
      return result;
    },
  },
  {
    name: "probe",
    description: "파일 하나의 길이(초), 해상도, fps, 소리 유무를 잰다.",
    parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false },
    run: (ws, a) => probe(ws, a.file),
  },
  {
    name: "trim",
    description: "영상의 start초부터 end초까지만 잘라 새 파일로 저장한다. 길이는 프레임 단위로 맞춰진다(24fps면 1/24초). 결과의 duration을 보고 다음 계획을 세운다.",
    parameters: {
      type: "object",
      properties: { input: { type: "string" }, start: { type: "number" }, end: { type: "number" }, output: { type: "string", description: "예: tmp/clip1_cut.mp4" } },
      required: ["input", "start", "end", "output"],
      additionalProperties: false,
    },
    async run(ws, a) {
      if (!(a.end > a.start)) throw new Error("end는 start보다 커야 합니다.");
      const info = await probe(ws, a.input);
      const frames = Math.max(1, Math.round((a.end - a.start) * info.fps));
      const dur = (frames / info.fps).toFixed(6);
      const args = ["-ss", String(a.start), "-i", ws.p(a.input), "-frames:v", String(frames), "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
      if (info.has_audio) args.push("-af", `apad,atrim=0:${dur},asetpts=PTS-STARTPTS`, "-c:a", "aac", "-b:a", "192k");
      await ws.ff([...args, ws.outPath(a.output)]);
      return probe(ws, a.output);
    },
  },
  {
    name: "concat",
    description: "영상 여러 개를 순서대로 이어 붙인다. 해상도·fps가 달라도 첫 영상 기준(또는 width/height/fps 지정)으로 맞춘다. 소리 없는 영상에는 무음을 채운다.",
    parameters: {
      type: "object",
      properties: {
        inputs: { type: "array", items: { type: "string" }, minItems: 2 },
        output: { type: "string" },
        width: { type: "integer" },
        height: { type: "integer" },
        fps: { type: "number" },
      },
      required: ["inputs", "output"],
      additionalProperties: false,
    },
    async run(ws, a) {
      const infos = [];
      for (const f of a.inputs) infos.push(await probe(ws, f));
      const W = a.width ?? infos[0].width, H = a.height ?? infos[0].height, FPS = a.fps ?? (infos[0].fps || 30);
      const args = [];
      for (const f of a.inputs) args.push("-i", ws.p(f));
      let extra = a.inputs.length;
      const parts = [];
      const filters = infos.map((info, i) => {
        let audio = `${i}:a`;
        if (!info.has_audio) {
          args.push("-f", "lavfi", "-t", String(info.duration), "-i", "anullsrc=r=48000:cl=stereo");
          audio = `${extra++}:a`;
        }
        parts.push(`[v${i}][a${i}]`);
        return `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}];` +
          `[${audio}]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${info.duration},asetpts=PTS-STARTPTS[a${i}]`;
      });
      const fc = filters.join(";") + ";" + parts.join("") + `concat=n=${infos.length}:v=1:a=1[v][a]`;
      await ws.ff([...args, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k", ws.outPath(a.output)]);
      return probe(ws, a.output);
    },
  },
  {
    name: "add_music",
    description: "영상에 음악을 얹는다. 음악은 영상 길이에 맞춰 자르고 끝에서 fade_out초 동안 줄인다. keep_original_audio가 true면 원래 소리와 섞는다.",
    parameters: {
      type: "object",
      properties: {
        video: { type: "string" },
        music: { type: "string" },
        output: { type: "string" },
        music_start: { type: "number", description: "음악을 몇 초 지점부터 쓸지. 기본 0" },
        music_volume: { type: "number", description: "1.0이 원래 크기. 기본 1.0" },
        fade_out: { type: "number", description: "끝 페이드아웃 초. 기본 1.5" },
        keep_original_audio: { type: "boolean" },
        original_volume: { type: "number", description: "원래 소리를 섞을 때 크기. 기본 0.5(음악 아래로)" },
      },
      required: ["video", "music", "output"],
      additionalProperties: false,
    },
    async run(ws, a) {
      const v = await probe(ws, a.video);
      const D = v.duration, fade = Math.min(a.fade_out ?? 1.5, D), ss = a.music_start ?? 0;
      const m = `[1:a]atrim=start=${ss}:duration=${D},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${a.music_volume ?? 1},afade=t=out:st=${(D - fade).toFixed(3)}:d=${fade}`;
      const fc = a.keep_original_audio && v.has_audio
        ? `${m}[m];[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${a.original_volume ?? 0.5}[o];[o][m]amix=inputs=2:duration=first:normalize=0[a]`
        : `${m}[a]`;
      await ws.ff(["-i", ws.p(a.video), "-i", ws.p(a.music), "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(D), ws.outPath(a.output)]);
      return probe(ws, a.output);
    },
  },
  {
    name: "export_final",
    description: "마지막 내보내기. duration을 주면 길이를 프레임 단위로 정확히 맞춘다(모자라면 마지막 장면을 늘리고 넘치면 자른다). 음량은 유튜브 기준 -14 LUFS, 피크는 -1dB 아래로 맞추고 H.264 MP4로 저장한다. output은 out/ 아래에 둔다.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string" },
        output: { type: "string", description: "예: out/final.mp4" },
        duration: { type: "number", description: "목표 길이(초). 길이 지시가 있으면 꼭 준다." },
        target_lufs: { type: "number" },
      },
      required: ["input", "output"],
      additionalProperties: false,
    },
    async run(ws, a) {
      const I = a.target_lufs ?? -14;
      const info = await probe(ws, a.input);
      const frames = Math.round((a.duration ?? info.duration) * info.fps);
      const dur = (frames / info.fps).toFixed(6);
      // 음량: 이득을 계산해 올리고 리미터(-1.9dB)로 피크를 누른 뒤, 다시 재서 한 번 더 보정한다
      const wav = ws.outPath("tmp/_loud.wav");
      let gain = I - (await measureLoudness(ws, a.input)).integrated_lufs;
      let got;
      for (let pass = 0; pass < 3; pass++) {
        await ws.ff(["-i", ws.p(a.input), "-vn", "-af", `apad,atrim=0:${dur},volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:level=0:attack=5:release=50`, "-ar", "48000", "-ac", "2", wav]);
        got = (await measureLoudness(ws, "tmp/_loud.wav")).integrated_lufs;
        if (Math.abs(got - I) <= 0.2) break;
        gain += I - got;
      }
      await ws.ff(["-i", ws.p(a.input), "-i", wav, "-map", "0:v", "-map", "1:a", "-vf", "tpad=stop_mode=clone:stop_duration=5", "-frames:v", String(frames),
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-t", dur, ws.outPath(a.output)]);
      // fs.rmSync는 일부 윈도우 환경에서 프로세스를 소리 없이 죽인다(2026-11-03 확인). unlinkSync만 쓴다.
      try { fs.unlinkSync(wav); } catch {}
      return { ...(await probe(ws, a.output)), loudness: await measureLoudness(ws, a.output) };
    },
  },
  {
    name: "measure",
    description: "파일의 실제 길이와 음량(LUFS, 트루피크)을 잰다. 작업이 끝나면 결과 파일을 꼭 재서 지시대로 됐는지 확인한다.",
    parameters: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false },
    async run(ws, a) {
      const info = await probe(ws, a.file);
      return { ...info, loudness: info.has_audio ? await measureLoudness(ws, a.file) : null };
    },
  },
];
