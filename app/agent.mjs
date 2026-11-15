// 무덱스 에이전트: 클로드 코드·코덱스처럼 프로젝트 폴더에서 파일을 읽고 쓰고 명령을 실행하며,
// 커넥터(MCP)로 바깥 서비스(예: 힉스필드)의 도구를 부른다. 켜 둔 스킬(예: 영상)의 도구도 함께 쓴다.
// OpenAI 키는 없다. 강사 코드로 중계 서버(mudex-relay)를 부른다.
import { CORE_TOOLS } from "./core_tools.mjs";
import { MCP_TOOLS } from "./mcp_bridge.mjs";
import { SKILLS } from "./skills.mjs";

export const DEFAULT_RELAY = "https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay";

const BASE = `너는 '무덱스'다. 클로드 코드·코덱스 같은 바이브코딩 에이전트로, 사용자의 프로젝트 폴더 안에서 일한다.
사용자는 초·중등 교사이고 코딩을 잘 모른다. 말투는 짧고 친절한 한국어 존댓말, 전문 용어는 풀어서.

일하는 법
- 경로는 프로젝트 폴더 기준 상대 경로. 폴더 밖은 다루지 않는다.
- 여러 단계 일은 update_plan으로 3~6단계를 세우고, 끝날 때마다 done_count를 올린다. 짧은 질문에는 쓰지 않는다.
- 먼저 list_files로 무엇이 있는지 보고, 고치기 전에 read_file로 읽는다. 일부만 바꿀 때는 edit_file, 새 파일은 write_file.
- 명령(run_command)은 꼭 필요할 때만. why에 무엇을 하려는지 쉬운 말로 쓴다. 허락이 거절되면 다시 하지 말고 무엇을 바꿀지 묻는다.
- 웹페이지를 만들면 한 폴더에 index.html로 만들고(바깥 라이브러리는 CDN), 사용자가 오른쪽 미리보기에서 바로 볼 수 있다고 알려 준다.
- 끝나면 무엇을 만들었는지, 어디에 있는지(파일 경로), 확인한 것과 못 한 것을 짧게 보고한다.

커넥터(MCP)
- 바깥 서비스는 커넥터로 연결되어 있다. mcp_list_tools로 찾고(query로 거르기) → mcp_describe로 입력 모양을 보고 → mcp_call로 부른다.
- 만들기 도구는 화면에서 허락을 받으며 크레딧이 들 수 있다. 사용자가 시키지 않은 생성은 하지 않는다.
- 생성은 보통 작업 번호를 돌려준다. job_status나 jobs_wait로 끝날 때까지 기다리고, 결과 주소를 download_file로 프로젝트에 받는다. 사진을 올려야 하면 media_upload → upload_file → media_confirm.
- 연결된 커넥터가 없으면 왼쪽 아래 '커넥터'에서 연결해 달라고 안내한다.
- 그림이 필요하면 make_image(무덱스 자체 이미지 생성, 크레딧 0)를 먼저 쓴다.`;

export function buildAgent(skills = {}) {
  const on = Object.entries(SKILLS).filter(([k]) => skills[k] !== false);
  const tools = [...CORE_TOOLS, ...MCP_TOOLS, ...on.flatMap(([, s]) => s.tools)];
  const system = [BASE, ...on.map(([, s]) => s.prompt)].join("\n\n");
  return { tools, system };
}

// Responses API로 부른다(추론 모델이 추론과 도구 호출을 함께 쓰는 길). store:false라 대화는 우리가 들고 있다.
async function respond(code, relay, body, signal) {
  const r = await fetch(`${relay}/v1/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${code}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? JSON.stringify(j).slice(0, 300));
  return j;
}

export async function relayStatus(code, relay = DEFAULT_RELAY) {
  const r = await fetch(`${relay}/status`, { headers: { Authorization: `Bearer ${code}` } });
  return { ok: r.ok, status: r.status, body: await r.json() };
}

export const DEFAULT_MODEL = "gpt-6.1-terra";
export const DEFAULT_EFFORT = "medium";

// messages: 이전 대화(Responses 입력 항목 배열)를 넘기면 이어서 한다. 끝나면 갱신된 배열을 돌려준다.
// ctx: { emit, ask, hf, signal }
export async function runAgent({ code, relay = DEFAULT_RELAY, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, ws, instruction, messages = [], ctx = {}, skills = {}, maxSteps = 40 }) {
  const emit = ctx.emit ?? (() => {});
  const { tools: ALL_TOOLS, system: SYSTEM } = buildAgent(skills);
  const tools = ALL_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  // 예전(Chat Completions) 형식 기록이면 버리고 새로 시작한다
  const prev = messages.some((m) => m.role === "tool" || m.tool_calls) ? [] : messages;
  const history = [...prev, { role: "user", content: instruction }];
  let totalCost = 0;
  const fullCtx = { approval: "ask", session: {}, ...ctx, emit, code, relay };
  for (let step = 0; step < maxSteps; step++) {
    if (ctx.signal?.aborted) throw new Error("멈췄습니다.");
    const res = await respond(code, relay, {
      model, instructions: SYSTEM, input: history, tools, reasoning: { effort },
      store: false, include: ["reasoning.encrypted_content"],
    }, ctx.signal);
    totalCost += res.mudex?.cost_usd ?? 0;
    emit({ type: "cost", step, cost_usd: res.mudex?.cost_usd, remaining_usd: res.mudex?.remaining_usd });
    history.push(...res.output);
    const text = res.output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("\n").trim();
    if (text) emit({ type: "assistant", text });
    const calls = res.output.filter((o) => o.type === "function_call");
    if (!calls.length) return { final: text, totalCost, messages: history };
    // 도구는 차례로 실행한다(ffmpeg 동시 실행으로 PC가 버벅이지 않게)
    for (const call of calls) {
      const tool = ALL_TOOLS.find((t) => t.name === call.name);
      let args = {};
      let result;
      let ok = true;
      const t0 = Date.now();
      try {
        args = JSON.parse(call.arguments || "{}");
        emit({ type: "tool_call", id: call.call_id, name: call.name, args });
        if (!tool) throw new Error(`없는 도구: ${call.name}`);
        result = await tool.run(ws, args, fullCtx);
      } catch (e) {
        ok = false;
        result = { error: e.message };
      }
      emit({ type: "tool_result", id: call.call_id, name: call.name, ok, ms: Date.now() - t0, result });
      history.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  throw new Error(`${maxSteps}단계 안에 끝나지 않았습니다.`);
}
