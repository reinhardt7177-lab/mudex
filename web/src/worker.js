// 무덱스 웹판 워커: 정적 화면을 내주고, 브라우저 직접 호출을 막는 MCP 서버만 넘겨준다(/proxy).
// 넘겨주기만 하고 아무것도 저장·기록하지 않는다(토큰이 지나가므로 로그도 남기지 않는다).
const ALLOW = new Set(["mcp.higgsfield.ai"]);
const PASS_REQ = ["authorization", "content-type", "accept", "mcp-protocol-version", "mcp-session-id", "last-event-id", "user-agent", "accept-language"];
const PASS_RES = ["content-type", "mcp-session-id", "www-authenticate", "cache-control"];

async function proxy(req) {
  const target = new URL(req.url).searchParams.get("u");
  let u;
  try { u = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
  if (u.protocol !== "https:" || !ALLOW.has(u.host)) return new Response("not allowed", { status: 403 });
  if (!["GET", "POST", "DELETE"].includes(req.method)) return new Response("method", { status: 405 });
  const headers = new Headers();
  for (const h of PASS_REQ) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const res = await fetch(u.toString(), { method: req.method, headers, body: req.method === "POST" ? req.body : undefined, redirect: "manual" });
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of PASS_RES) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.body, { status: res.status, headers: out });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/proxy") {
      // 같은 사이트(무덱스 화면)에서 온 요청만 넘긴다
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) return new Response("forbidden", { status: 403 });
      return proxy(req);
    }
    // /practice, /oauth/callback 은 정적 파일(.html)이 그대로 맡는다
    const res = await env.ASSETS.fetch(req);
    const h = new Headers(res.headers);
    h.set("x-content-type-options", "nosniff");
    h.set("referrer-policy", "strict-origin-when-cross-origin");
    if (url.pathname === "/sw.js") h.set("cache-control", "no-cache");
    return new Response(res.body, { status: res.status, headers: h });
  },
};
