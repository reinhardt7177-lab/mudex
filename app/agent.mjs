// 영상 에이전트: OpenAI 모델이 함수 호출로 도구(ffmpeg·생성·대화형)를 써서 지시를 수행한다.
// OpenAI 키는 없다. 강사 코드로 중계 서버(mudex-relay)를 부른다.
import { TOOLS as EDIT_TOOLS } from "./ffmpeg_tools.mjs";
import { GEN_TOOLS } from "./gen_tools.mjs";

export const DEFAULT_RELAY = "https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay";
export const ALL_TOOLS = [...GEN_TOOLS, ...EDIT_TOOLS];

export const SYSTEM = `너는 '무덱스'의 영상 에이전트다. 사용자는 초·중등 교사이고, 연수에서 처음 AI 영상을 만들어 본다.
말투: 짧고 친절한 한국어 존댓말. 전문 용어는 풀어서.

일하는 법
- 작업 폴더 안의 파일만 다룬다. 경로는 작업 폴더 기준 상대 경로로 쓴다.
- 일을 시작하면 set_plan으로 3~6단계 할 일을 세우고, 단계가 끝날 때마다 done_count를 올려 다시 부른다. 짧은 질문에 답만 할 때는 쓰지 않는다.
- 먼저 list_clips로 무엇이 있는지 본다.
- 중간 파일은 tmp/ 아래에, 마지막 결과는 export_final로 out/ 아래에 만든다.

편집
- 길이 지시가 있으면 정확히 맞춘다. 자르기는 프레임 단위(fps 기준)이므로 길이를 프레임 수로 계산해 나누고(24fps면 18초=432프레임), export_final에 duration을 꼭 준다. 클립을 나눌 때는 각 클립의 앞부분을 쓴다.
- 음악이 있으면 add_music으로 얹고, 원래 소리는 지시가 없으면 빼지 않고 음악 아래로 작게 둔다(keep_original_audio true, original_volume 0.5).
- 끝나면 measure로 결과 파일을 재고, 지시와 맞는지 확인한 뒤 짧게 보고한다(파일 이름, 길이, 음량).

생성
- 새 장면이 필요하면: 장면을 2~4컷 스토리보드로 짧게 정리해 보여 준다 → 컷마다 make_keyframes로 첫 장면 사진을 뽑는다(크레딧 0) → ask_pick으로 사용자가 고르게 한다 → generate_video로 영상 생성(화면에서 크레딧 허락을 받는다) → review_sheet로 움직임이 시작되는 1초를 8fps로 보여 준다.
- 사진 프롬프트와 영상 프롬프트는 영어로 쓴다. 사진은 장면·빛·렌즈·구도를, 영상은 움직임과 카메라를 쓴다. 실존 인물·상표·글자는 넣지 않는다.
- 허락이 거절되면 다시 시도하지 말고 무엇을 바꿀지 묻는다.
- 클링은 3~10초. 기본은 kling3_0, 5초.`;

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
export async function runAgent({ code, relay = DEFAULT_RELAY, model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, ws, instruction, messages = [], ctx = {}, maxSteps = 30 }) {
  const emit = ctx.emit ?? (() => {});
  const tools = ALL_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
  // 예전(Chat Completions) 형식 기록이면 버리고 새로 시작한다
  const prev = messages.some((m) => m.role === "tool" || m.tool_calls) ? [] : messages;
  const history = [...prev, { role: "user", content: instruction }];
  let totalCost = 0;
  const fullCtx = { ...ctx, emit, code, relay };
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
