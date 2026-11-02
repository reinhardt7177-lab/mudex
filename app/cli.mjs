// 무덱스 편집 에이전트 명령줄 시연
//   node app/cli.mjs --code MDX-XXXX-XXXX --dir work/demo "클립 3개 이어 붙이고 18초로, 음악 얹어서 내보내 줘"
// 강사 코드는 --code 대신 환경변수 MUDEX_CODE로 줘도 된다.
import fs from "node:fs";
import path from "node:path";
import { Workspace, probe, measureLoudness } from "./ffmpeg_tools.mjs";
import { runAgent, relayStatus } from "./agent.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const code = opt("code") ?? process.env.MUDEX_CODE;
const dir = opt("dir") ?? "work/demo";
const model = opt("model") ?? "gpt-6.1-terra";
const instruction = argv.join(" ");
if (!code || !instruction) { console.error('사용법: node app/cli.mjs --code MDX-XXXX-XXXX --dir work/demo "지시"'); process.exit(1); }

const logFile = path.join(dir, "out", "agent_log.txt");
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = (s) => { console.log(s); fs.appendFileSync(logFile, s + "\n"); };
fs.writeFileSync(logFile, `# ${new Date().toISOString()}\n# 지시: ${instruction}\n`);

const st = await relayStatus(code);
if (!st.ok) { log(`강사 코드 확인 실패: ${st.body.error?.message}`); process.exit(1); }
log(`강사 코드 확인: ${st.body.label}, 남은 한도 ${st.body.remaining_usd}달러, 만료 ${st.body.expires_at}`);

const ws = new Workspace(dir, (s) => fs.appendFileSync(logFile, "    " + s + "\n"));
const t0 = Date.now();
const res = await runAgent({
  code, model, ws, instruction,
  ctx: {
    // 명령줄에서는 고르기는 첫 번째로, 크레딧 허락은 거절로 답한다
    ask: async (kind, p) => (kind === "pick" ? p.files[0] : "no"),
    emit(e) {
    if (e.type === "tool_call") log(`→ ${e.name} ${JSON.stringify(e.args)}`);
    else if (e.type === "tool_result") log(`  ← ${JSON.stringify(e.result).slice(0, 400)}`);
    else if (e.type === "assistant") log(`\n[에이전트] ${e.text}\n`);
    else if (e.type === "cost") log(`  (호출 ${e.step + 1}: ${e.cost_usd}달러, 남은 한도 ${e.remaining_usd}달러)`);
    },
  },
});

// 에이전트 말을 믿지 않고 out/의 최신 mp4를 직접 잰다
const outs = fs.readdirSync(path.join(dir, "out")).filter((f) => f.endsWith(".mp4"))
  .map((f) => ({ f, t: fs.statSync(path.join(dir, "out", f)).mtimeMs })).sort((a, b) => b.t - a.t);
log(`\n===== 검증 (프로그램이 직접 측정) =====`);
if (!outs.length) log("out/에 결과 mp4가 없습니다.");
else {
  const f = path.join("out", outs[0].f);
  const info = await probe(ws, f);
  const loud = await measureLoudness(ws, f);
  log(`파일: ${path.join(dir, f)}`);
  log(`길이: ${info.duration}초, ${info.width}x${info.height}, ${info.fps}fps`);
  log(`음량: ${loud.integrated_lufs} LUFS, 트루피크 ${loud.true_peak_db} dBTP`);
}
log(`걸린 시간 ${((Date.now() - t0) / 1000).toFixed(1)}초, 모델 비용 ${res.totalCost.toFixed(5)}달러`);
