// MCP 다리: 연결된 커넥터의 도구를 에이전트가 쓰게 한다.
// 도구가 많아서(힉스필드 185개) 처음부터 전부 넘기지 않고, 클로드 코드의 '도구 찾기'처럼
// 찾기(mcp_list_tools) → 설명 보기(mcp_describe) → 부르기(mcp_call) 세 단계로 쓴다.
// 조회 도구는 바로 부르고, 그 밖의 도구는 화면에서 허락을 받는다. 크레딧 미리보기(get_cost)가 되면 비용을 보여 준다.
const READ_ONLY = /^(balance|transactions|models_explore|list_|get_|search|show_|job_status|jobs_wait|job_display|apps_search|apps_describe)/;
const MAX_RESULT = 12000;
const clip = (s) => (s.length > MAX_RESULT ? s.slice(0, MAX_RESULT) + `…(${s.length - MAX_RESULT}자 줄임)` : s);

function costPreviewArgs(schema, args) {
  const p = schema?.properties ?? {};
  if (p.params?.anyOf?.some((x) => x.properties?.get_cost) || p.params?.properties?.get_cost) {
    if (args.params && typeof args.params === "object") return { ...args, params: { ...args.params, get_cost: true } };
  }
  if (p.get_cost) return { ...args, get_cost: true };
  return null;
}

// 힉스필드는 비용 대신 "프리셋을 쓸까요?" 추천을 돌려줄 때가 있다. 지시 그대로 만들도록 추천을 거절한다.
function applyPresetDecline(args, res) {
  const retry = res?.notice?.type === "preset_recommendation" && res.notice.data?.retry_literal_with;
  if (!retry) return null;
  return args.params ? { ...args, params: { ...args.params, ...retry } } : { ...args, ...retry };
}

export const MCP_TOOLS = [
  {
    name: "mcp_list_tools",
    description: "연결된 커넥터(MCP 서버)와 그 도구를 찾는다. query로 이름·설명을 걸러 본다(예: video, upload, balance). 부르기 전에 mcp_describe로 입력 모양을 확인한다.",
    parameters: {
      type: "object",
      properties: { connector: { type: "string", description: "커넥터 이름. 비우면 연결된 전부" }, query: { type: "string" } },
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
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
    parameters: {
      type: "object",
      properties: { connector: { type: "string" }, tool: { type: "string" } },
      required: ["tool"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const c = ctx.connectors.find(a.connector);
      const t = (await ctx.connectors.tools(c.id)).find((x) => x.name === a.tool);
      if (!t) throw new Error(`${c.name}에 '${a.tool}' 도구가 없습니다. mcp_list_tools로 찾아보세요.`);
      return { connector: c.name, name: t.name, description: clip(t.description ?? ""), input_schema: t.inputSchema };
    },
  },
  {
    name: "mcp_call",
    description: "커넥터 도구를 부른다. arguments는 mcp_describe에서 본 입력 모양 그대로. 조회 도구는 바로 실행되고, 만들기·바꾸기 도구는 화면에서 허락을 받는다(크레딧이 들면 비용을 보여 줌). 거절되면 다시 부르지 말고 사용자에게 무엇을 바꿀지 묻는다.",
    parameters: {
      type: "object",
      properties: { connector: { type: "string" }, tool: { type: "string" }, arguments: { type: "object", additionalProperties: true } },
      required: ["tool", "arguments"],
      additionalProperties: false,
    },
    async run(ws, a, ctx) {
      const c = ctx.connectors.find(a.connector);
      const tools = await ctx.connectors.tools(c.id);
      const t = tools.find((x) => x.name === a.tool);
      if (!t) throw new Error(`${c.name}에 '${a.tool}' 도구가 없습니다.`);
      let args = a.arguments ?? {};
      const label = `${c.name} · ${a.tool}`;
      ctx.emit({ type: "mcp", connector: c.name, tool: a.tool, practice: !!c.practice });

      if (!READ_ONLY.test(a.tool)) {
        // 비용 미리보기(크레딧 0). 프리셋 추천이 오면 거절하고 다시 본다.
        let credits = null;
        const pre = c.practice ? null : costPreviewArgs(t.inputSchema, args);
        if (pre) {
          let preArgs = pre;
          for (let i = 0; i < 3; i++) {
            const r = await ctx.connectors.callAny(c.id, a.tool, preArgs).catch((e) => ({ error: e.message }));
            const declined = applyPresetDecline(preArgs, r);
            if (declined) { preArgs = declined; args = applyPresetDecline(args, r); continue; }
            credits = r?.cost?.credits ?? null;
            break;
          }
        }
        let balance = null;
        if (credits != null) balance = (await ctx.connectors.callAny(c.id, "balance", {}).catch(() => null))?.credits ?? null;
        const needsAsk = ctx.approval !== "auto" || credits != null || c.practice;
        if (needsAsk) {
          const ans = await ctx.ask("approve", {
            kind2: "mcp", title: credits != null ? "크레딧을 써서 실행할까요?" : "이 도구를 실행할까요?",
            connector: c.name, tool: a.tool, practice: !!c.practice, args: clip(JSON.stringify(args, null, 2)),
            credits, balance, summary: (t.description ?? "").replace(/\s+/g, " ").slice(0, 200),
          });
          if (ans !== "yes") return { approved: false, user_said: ans };
        }
      }
      const res = await ctx.connectors.callAny(c.id, a.tool, args);
      const text = JSON.stringify(res);
      ctx.emit({ type: "mcp_result", connector: c.name, tool: a.tool, ok: true, label });
      return text.length > MAX_RESULT ? { truncated: true, result: clip(text) } : res;
    },
  },
];
