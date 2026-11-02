// 시연용 재료 만들기: 길이·해상도가 다른 클립 3개와 음악 1개 (크레딧 안 씀)
//   node app/make_demo.mjs work/demo
import fs from "node:fs";
import path from "node:path";
import { Workspace } from "./ffmpeg_tools.mjs";

const dir = process.argv[2] ?? "work/demo";
const ws = new Workspace(dir);
const font = "C\\:/Windows/Fonts/malgunbd.ttf";
const label = (t) => `drawtext=fontfile='${font}':text='${t}':fontsize=h/9:fontcolor=white:borderw=4:bordercolor=black@0.6:x=(w-tw)/2:y=h*0.72`;

const clips = [
  { name: "clip1_바다.mp4", src: "mandelbrot=size=1280x720:rate=30", dur: 10, text: "클립 1", tone: 330 },
  { name: "clip2_숲.mp4", src: "life=size=1920x1080:rate=30:mold=10:ratio=0.2:death_color=#0b3d2e:life_color=#7cd992,scale=1920:1080:flags=neighbor", dur: 8, text: "클립 2", tone: null },
  { name: "clip3_마을.mp4", src: "testsrc2=size=1280x720:rate=24", dur: 12, text: "클립 3", tone: 440 },
];
for (const c of clips) {
  const args = ["-f", "lavfi", "-t", String(c.dur), "-i", c.src];
  if (c.tone) args.push("-f", "lavfi", "-t", String(c.dur), "-i", `sine=frequency=${c.tone}:sample_rate=48000,volume=0.15`);
  args.push("-vf", `${label(c.text)},drawtext=fontfile='${font}':text='%{eif\\:t\\:d}초':fontsize=h/14:fontcolor=yellow:x=40:y=40`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast");
  if (c.tone) args.push("-c:a", "aac", "-shortest");
  await ws.ff([...args, ws.outPath(c.name)]);
  console.log("만듦:", c.name);
}
// 30초 음악: 네 화음이 2초씩 도는 패드 + 박자
const chords = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]];
const expr = chords.map((ch, i) => `(between(mod(t,8),${i * 2},${i * 2 + 2})*(${ch.map((f) => `sin(2*PI*${f}*t)`).join("+")}))`).join("+");
await ws.ff(["-f", "lavfi", "-t", "30", "-i", `aevalsrc='0.12*(${expr})*(0.6+0.4*exp(-6*mod(t,0.5)))':s=48000:c=stereo`, "-c:a", "libmp3lame", "-q:a", "3", ws.outPath("음악_밝은패드.mp3")]);
console.log("만듦: 음악_밝은패드.mp3");
// 빈 out 폴더만 치운다(fs.rmSync는 일부 윈도우 환경에서 프로세스를 죽여서 쓰지 않음)
try { fs.rmdirSync(path.join(ws.dir, "out")); } catch {}
