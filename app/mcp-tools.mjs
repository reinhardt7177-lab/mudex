// Discover the connected catalogs on demand instead of sending hundreds of schemas every turn.
import { importHiggsfieldMedia } from "./remote-media.mjs";
function connected(ctx) {
  if (!ctx.connectors) throw new Error("MCP 커넥터가 준비되지 않았습니다.");
  return ctx.connectors;
}

export const MCP_TOOLS = [
  {
    name: "import_higgsfield_media",
    description: "기존 힉스필드 작업 번호(jobId)로 완료된 영상·사진·음악을 현재 작업 폴더에 가져와 편집할 수 있게 한다. 사용자가 제공했거나 로그인된 MCP 라이브러리 조회 결과에서 확인한 기존 작업만 사용한다. 임의 링크나 확인되지 않은 작업 번호를 추측하지 않는다. 공유 폴더 작업은 folderId도 받는다. 생성이나 크레딧 사용 없이 기존 결과만 내려받는다. 최대 전체 2GB.",
    parameters: {
      type: "object",
      properties: { jobId: { type: "string", description: "사용자가 제공했거나 로그인된 라이브러리 조회에서 확인한 기존 작업 UUID" }, folderId: { type: "string", description: "공유 폴더 UUID (선택)" }, name: { type: "string", description: "로컬 파일 이름 앞부분 (선택)" } },
      required: ["jobId"], additionalProperties: false,
    },
    run: importHiggsfieldMedia,
  },
  {
    name: "list_mcp_connectors",
    description: "연결된 MCP 서버와 로그인 상태를 조회한다. 사용 가능한 도구는 search_mcp_tools로 찾는다.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async run(ws, args, ctx) {
      return { connectors: connected(ctx).view().map(({ id, name, practice, connected, logging_in, tools_count }) => ({ id, name, practice, connected, logging_in, tools_count })) };
    },
  },
  {
    name: "search_mcp_tools",
    description: "연결된 모든 MCP 서버의 도구를 이름·설명으로 검색한다. 조회·생성·편집·삭제·공개 도구를 모두 찾을 수 있다. 전체 입력 스키마와 승인 정책을 반환한다. 빈 검색어로도 탐색할 수 있다. 결과가 많으면 검색어를 좁힌다.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["query"], additionalProperties: false,
    },
    async run(ws, args, ctx) { return connected(ctx).search(args.query ?? "", args.limit ?? 8); },
  },
  {
    name: "call_mcp_tool",
    description: "검색한 MCP 도구를 정확한 connector_id·tool_name·arguments로 호출한다. 읽기와 검색은 즉시 실행한다. 크레딧 사용·변경·삭제·공개 또는 효과가 불분명한 도구는 구체적인 인자를 사용자에게 보여 주고 이번 호출의 승인을 받는다. 모델이 approved/get_cost 등을 넣어도 승인을 대신할 수 없다. 거절되면 멈춘다.",
    parameters: {
      type: "object",
      properties: {
        connector_id: { type: "string" }, tool_name: { type: "string" },
        arguments: { type: "object", additionalProperties: true, description: "검색 결과의 inputSchema에 맞는 구체적인 전체 인자" },
      },
      required: ["connector_id", "tool_name", "arguments"], additionalProperties: false,
    },
    async run(ws, args, ctx) {
      const connectors = connected(ctx);
      if(ctx.signal?.aborted)throw new Error('멈췄습니다.');
      const { approval_token, ...proposal } = await connectors.prepareCall(args.connector_id, args.tool_name, args.arguments ?? {});
      if(ctx.signal?.aborted)throw new Error('멈췄습니다.');
      if (proposal.approval_required) {
        if (typeof ctx.ask !== "function") throw new Error("이 도구는 사용자 승인(approval) 화면이 필요합니다.");
        const answer = await ctx.ask("mcp_approve", proposal);
        if (answer !== "yes") return { approved: false, user_said: answer };
      }
      if (ctx.signal?.aborted) throw new Error("멈췄습니다.");
      return connectors.call(args.connector_id, args.tool_name, proposal.arguments, approval_token ? { approval_token } : {});
    },
  },
];
