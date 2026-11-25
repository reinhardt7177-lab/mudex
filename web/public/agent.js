// 무덱스 에이전트(웹판): 클로드 코드·코덱스처럼 프로젝트 폴더에서 파일을 읽고 쓰고 코드를 실행하며,
// 커넥터(MCP)로 바깥 서비스(예: 힉스필드)의 도구를 부른다. OpenAI 키는 없다. 강사 코드로 중계 서버를 부른다.
import { CORE_TOOLS, MCP_TOOLS } from "./tools.js";
import { VIDEO_TOOLS } from "./video.js";

export const DEFAULT_RELAY = "https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay";
export const DEFAULT_MODEL = "gpt-6.1-terra";
export const DEFAULT_EFFORT = "medium";

const SYSTEM = `너는 '무덱스'다. 클로드 코드·코덱스 같은 바이브코딩 에이전트로, 사용자의 프로젝트 폴더 안에서 일한다. 지금은 웹판이라 프로젝트 폴더는 브라우저 저장소에 있다.
사용자는 초·중등 교사이고 코딩을 잘 모른다. 말투는 짧고 친절한 한국어 존댓말, 전문 용어는 풀어서.

일하는 법
- 경로는 프로젝트 폴더 기준 상대 경로. 폴더 밖은 다루지 않는다.
- 여러 단계 일은 update_plan으로 3~6단계를 세우고, 끝날 때마다 done_count를 올린다. 짧은 질문에는 쓰지 않는다.
- 먼저 list_files로 무엇이 있는지 보고, 고치기 전에 read_file로 읽는다. 일부만 바꿀 때는 edit_file, 새 파일은 write_file.
- 명령창은 없다. 계산·자료 만들기·검사는 run_js(브라우저 샌드박스)로 한다. why에 무엇을 하려는지 쉬운 말로. 거절되면 다시 하지 말고 무엇을 바꿀지 묻는다.
- 웹페이지를 만들면 index.html로 만들고(바깥 라이브러리는 CDN), 끝나면 check_page로 실제로 열어 오류를 확인한다. 사용자는 오른쪽 미리보기에서 바로 볼 수 있다.
- 끝나면 무엇을 만들었는지, 어디에 있는지(파일 경로), 확인한 것과 못 한 것을 짧게 보고한다.

커넥터(MCP)
- 바깥 서비스는 커넥터로 연결되어 있다. mcp_list_tools로 찾고(query로 거르기) → mcp_describe로 입력 모양을 보고 → mcp_call로 부른다.
- 만들기 도구는 화면에서 허락을 받으며 크레딧이 들 수 있다. 사용자가 시키지 않은 생성은 하지 않는다.
- 생성은 보통 작업 번호를 돌려준다. job_status나 jobs_wait로 끝날 때까지 기다리고, 결과 주소를 download_file로 프로젝트에 받는다. 사진을 올려야 하면 media_upload → upload_file → media_confirm.
- 연결된 커넥터가 없으면 왼쪽 아래 '커넥터'에서 연결해 달라고 안내한다.
- 스토리보드나 캐릭터 보드를 만들 때는 먼저 read_guide로 양식을 읽고 그 칸과 모양을 따른다. 사용자가 다른 양식을 말하면 사용자 것을 따른다.
- 그림이 필요하면 make_image(무덱스 자체 이미지 생성, 크레딧 0)를 먼저 쓴다.
- 최신 정보(가격·모델·사용법 등)가 필요하면 web_search로 인터넷을 찾아본다. 찾은 내용은 출처와 함께 짧게 알려 준다.
- 영상 자르기·잇기·음악·음량은 list_clips·trim·concat·add_music·export_final·measure(브라우저 안 ffmpeg)로 한다. 처음 한 번 준비에 시간이 걸리고, 다시 인코딩하는 일(자르기, 크기가 다른 영상 잇기)은 1080p에서 느리다.
- 정해진 편집 도구로 안 되는 일(로고 가리기·덮기, 그림·글자 얹기, 색·속도·크기 바꾸기)은 run_ffmpeg로 ffmpeg 명령을 직접 짠다. 화면 속 위치를 정해야 하면 먼저 run_ffmpeg로 그 시각의 화면을 png로 뽑아 보고 좌표를 정한다.
- 힉스필드 영상 모델을 따로 말하지 않으면 kling2_6(Kling 2.6)을 쓴다.`;

export function buildAgent() {
  const tools = [...CORE_TOOLS, ...VIDEO_TOOLS, ...MCP_TOOLS];
  return { tools, system: SYSTEM };
}

// 중계 서버 호출. 여럿이 한꺼번에 쓰면 OpenAI가 '잠시 후 다시'(429)나 일시 오류(5xx)를 주므로 몇 번 기다렸다 다시 한다
// 중계·OpenAI 오류를 연수생이 알아듣고 다음에 할 일을 알 수 있는 우리말로 바꾼다(영어 원문·조직 번호는 보이지 않게)
function koError(st, j) {
  const c = j?.error?.code ?? "", m = j?.error?.message ?? "";
  if (st === 429) return "지금 사람이 몰려 AI가 잠시 막혔어요. 1분쯤 뒤에 다시 보내 주세요.";
  if (st >= 500) return "AI 서버가 잠시 불안정해요. 조금 뒤에 다시 보내 주세요.";
  if (/context_length|maximum context/i.test(c + m)) return "대화가 너무 길어져 AI가 다 읽지 못해요. 새 프로젝트를 만들어 이어서 해 주세요.";
  if (/invalid_prompt|content_policy|moderation|safety/i.test(c + m)) return "AI가 이 내용은 만들 수 없다고 했어요. 표현을 바꿔서 다시 부탁해 주세요.";
  if ((st === 402 || st === 403) && m && !/강사님/.test(m)) return `${m} 강사님께 알려 주세요.`;
  return m || `중계 서버 오류 ${st}`;
}

export async function relayPost(relay, path, code, body, signal, onWait) {
  const waits = [3, 8, 20];
  for (let i = 0; ; i++) {
    let r, j = null, netErr = null;
    try {
      r = await fetch(`${relay}${path}`, { method: "POST", headers: { Authorization: `Bearer ${code}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
      j = await r.json().catch(() => null);
    } catch (e) { if (signal?.aborted) throw new Error("멈췄습니다."); netErr = e; }
    if (r?.ok && j) return j;
    const again = netErr || r.status === 429 || r.status >= 500;
    if (!again || i >= waits.length) throw new Error(netErr ? "인터넷 연결이 끊겼거나 중계 서버에 닿지 않습니다. 연결을 확인하고 다시 보내 주세요." : koError(r.status, j));
    const sec = Math.min(30, Number(r?.headers.get("retry-after")) || waits[i]);
    if (i === 0) onWait?.(); // 말없이 30초 넘게 멈춘 것처럼 보이지 않게 한 번 알린다
    await new Promise((res, rej) => { const t = setTimeout(res, sec * 1000); signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("멈췄습니다.")); }, { once: true }); });
  }
}
const respond = (code, relay, body, signal, onWait) => relayPost(relay, "/v1/responses", code, body, signal, onWait);

export async function relayStatus(code, relay = DEFAULT_RELAY) {
  const r = await fetch(`${relay}/status`, { headers: { Authorization: `Bearer ${code}` } });
  return { ok: r.ok, status: r.status, body: await r.json() };
}

// messages: 이전 대화(Responses 입력 항목 배열). 끝나면 갱신된 배열을 돌려준다.
export async function runAgent({ code, relay = DEFAULT_RELAY, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, instruction, messages = [], ctx, maxSteps = 40 }) {
  const { tools: ALL, system } = buildAgent();
  const tools = ALL.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  tools.push({ type: "web_search" }); // 인터넷 검색(OpenAI가 직접 찾아 옴, 한 번에 1센트)
  const history = [...messages, { role: "user", content: instruction }];
  await ctx.save?.(history);
  const full = { approval: "ask", session: {}, ...ctx, code, relay };
  let totalCost = 0;
  for (let step = 0; step < maxSteps; step++) {
    if (ctx.signal?.aborted) throw new Error("멈췄습니다.");
    const res = await respond(code, relay, { model, instructions: system, input: history, tools, reasoning: { effort }, store: false, include: ["reasoning.encrypted_content"] }, ctx.signal,
      () => ctx.emit({ type: "assistant", text: "사람이 많아 AI가 바빠요. 잠깐 기다렸다가 저절로 다시 해요." }));
    totalCost += res.mudex?.cost_usd ?? 0;
    ctx.emit({ type: "cost", step, cost_usd: res.mudex?.cost_usd, remaining_usd: res.mudex?.remaining_usd });
    history.push(...res.output);
    // 인터넷 검색은 OpenAI 쪽에서 이미 끝난 채로 온다. 화면에는 과정 한 줄로 보여 준다
    for (const s of res.output.filter((o) => o.type === "web_search_call")) {
      const q = s.action?.query ?? s.action?.url ?? "";
      ctx.emit({ type: "tool_call", id: s.id, name: "web_search", args: { query: q } });
      ctx.emit({ type: "tool_result", id: s.id, name: "web_search", ok: s.status !== "failed", ms: 0, result: { sources: (s.action?.sources ?? []).length } });
    }
    const text = res.output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n").trim();
    if (text) ctx.emit({ type: "assistant", text });
    const calls = res.output.filter((o) => o.type === "function_call");
    if (!calls.length) {
      // 답이 길이 한도에서 끊기면 조용히 끝난 것처럼 보이므로 알려 준다
      if (res.status === "incomplete") ctx.emit({ type: "assistant", text: "답이 너무 길어 중간에 끊겼어요. \"이어서 해 줘\"라고 적어 주세요." });
      return { final: text, totalCost, messages: history };
    }
    for (const call of calls) {
      if (ctx.signal?.aborted) throw new Error("멈췄습니다."); // 멈춤을 누른 뒤에는 남은 도구를 실행하지 않는다
      const tool = ALL.find((t) => t.name === call.name);
      let args = {}, result, ok = true;
      const t0 = performance.now();
      try {
        args = JSON.parse(call.arguments || "{}");
        ctx.emit({ type: "tool_call", id: call.call_id, name: call.name, args });
        if (!tool) throw new Error(`없는 도구: ${call.name}`);
        result = await tool.run(args, full);
      } catch (e) { ok = false; result = { error: e.message }; }
      ctx.emit({ type: "tool_result", id: call.call_id, name: call.name, ok, ms: Math.round(performance.now() - t0), result });
      history.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
    // 도구 결과까지 짝이 맞았을 때 저장한다. 새로 고침으로 끊겨도 여기까지는 기억한다
    await ctx.save?.(history);
  }
  throw new Error(`${maxSteps}단계 안에 끝나지 않았습니다.`);
}
