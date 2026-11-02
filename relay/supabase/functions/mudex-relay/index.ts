// 무덱스 중계 서버 (Supabase Edge Function)
// 연수생 프로그램은 강사 코드만 들고 이 함수에 붙는다. OpenAI 키는 함수 비밀값(OPENAI_API_KEY)에만 있다.
//
//   GET  /status                      (Authorization: Bearer <강사 코드>)  남은 한도·만료일
//   POST /v1/chat/completions         (Authorization: Bearer <강사 코드>)  OpenAI로 전달, 사용량만큼 차감
//   POST /v1/responses                (Authorization: Bearer <강사 코드>)  Responses API(추론+도구), 사용량만큼 차감
//   POST /v1/images/generations       (Authorization: Bearer <강사 코드>)  이미지 생성, 사용량만큼 차감
//   POST /admin/codes                 (x-admin-secret)  코드 발급 {count, budget_usd, expires_at, label}
//   GET  /admin/codes                 (x-admin-secret)  코드별 사용 현황
//   POST /admin/codes/disable         (x-admin-secret)  {code} 코드 끄기

import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const MAX_OUTPUT_TOKENS = 16000; // 한 번 호출로 한도를 크게 넘지 않게 묶는다

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAdmin(req: Request) {
  const given = req.headers.get("x-admin-secret");
  if (!given) return false;
  const [row] = await sql`select value from mudex.config where key = 'admin_secret_sha256'`;
  return !!row && row.value === (await sha256Hex(given));
}

async function loadCode(req: Request) {
  const code = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim().toUpperCase();
  if (!code) return { err: fail(401, "no_code", "강사 코드가 없습니다.") };
  const [row] = await sql`select * from mudex.codes where code = ${code}`;
  if (!row) return { err: fail(401, "bad_code", "없는 강사 코드입니다.") };
  if (row.disabled) return { err: fail(403, "disabled", "강사가 이 코드를 껐습니다.") };
  if (new Date(row.expires_at) < new Date()) return { err: fail(403, "expired", `코드가 만료되었습니다 (${row.expires_at.toISOString().slice(0, 10)}).`) };
  return { row };
}

const summary = (r: any) => ({
  label: r.label,
  budget_usd: Number(r.budget_usd),
  spent_usd: Number(Number(r.spent_usd).toFixed(4)),
  remaining_usd: Number(Math.max(0, r.budget_usd - r.spent_usd).toFixed(4)),
  expires_at: r.expires_at,
});

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  const s = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `MDX-${s.slice(0, 4)}-${s.slice(4)}`;
}

async function chat(req: Request) {
  const { row, err } = await loadCode(req);
  if (err) return err;
  if (Number(row.spent_usd) >= Number(row.budget_usd)) return fail(402, "budget_exhausted", `한도 ${row.budget_usd}달러를 다 썼습니다.`);

  let body: any;
  try { body = await req.json(); } catch { return fail(400, "bad_json", "요청 형식이 JSON이 아닙니다."); }
  const [price] = await sql`select * from mudex.models where model = ${body.model} and kind = 'chat' and enabled`;
  if (!price) {
    const allowed = await sql`select model from mudex.models where kind = 'chat' and enabled order by model`;
    return fail(400, "model_not_allowed", `허용된 모델: ${allowed.map((m: any) => m.model).join(", ")}`);
  }
  if (!OPENAI_KEY) return fail(503, "no_upstream_key", "강사가 아직 OpenAI 키를 서버에 넣지 않았습니다.");
  body.stream = false;
  delete body.stream_options;
  const asked = body.max_completion_tokens ?? body.max_tokens ?? MAX_OUTPUT_TOKENS;
  delete body.max_tokens;
  body.max_completion_tokens = Math.min(asked, MAX_OUTPUT_TOKENS);

  const up = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await up.text();
  let out: any;
  try { out = JSON.parse(text); } catch { return fail(502, "upstream_bad_response", text.slice(0, 300)); }
  if (!up.ok) return json(up.status, out);

  const u = out.usage ?? {};
  const inTok = u.prompt_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const outTok = u.completion_tokens ?? 0;
  const cost = ((inTok - cached) * Number(price.in_per_m) + cached * Number(price.cached_per_m) + outTok * Number(price.out_per_m)) / 1e6;
  const [{ charge: spent }] = await sql`select mudex.charge(${row.code}, ${body.model}, ${inTok}, ${cached}, ${outTok}, ${cost})`;
  out.mudex = {
    cost_usd: Number(cost.toFixed(6)),
    spent_usd: Number(Number(spent).toFixed(4)),
    remaining_usd: Number(Math.max(0, row.budget_usd - spent).toFixed(4)),
  };
  return json(200, out);
}

// Responses API: 추론 모델(gpt-6.1-terra 등)에서 추론과 도구 호출을 함께 쓰려면 이 길이 필요하다.
async function responses(req: Request) {
  const { row, err } = await loadCode(req);
  if (err) return err;
  if (Number(row.spent_usd) >= Number(row.budget_usd)) return fail(402, "budget_exhausted", `한도 ${row.budget_usd}달러를 다 썼습니다.`);

  let body: any;
  try { body = await req.json(); } catch { return fail(400, "bad_json", "요청 형식이 JSON이 아닙니다."); }
  const [price] = await sql`select * from mudex.models where model = ${body.model} and kind = 'chat' and enabled`;
  if (!price) {
    const allowed = await sql`select model from mudex.models where kind = 'chat' and enabled order by model`;
    return fail(400, "model_not_allowed", `허용된 모델: ${allowed.map((m: any) => m.model).join(", ")}`);
  }
  if (!OPENAI_KEY) return fail(503, "no_upstream_key", "강사가 아직 OpenAI 키를 서버에 넣지 않았습니다.");
  body.stream = false;
  body.background = false;
  body.max_output_tokens = Math.min(body.max_output_tokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);

  const up = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await up.text();
  let out: any;
  try { out = JSON.parse(text); } catch { return fail(502, "upstream_bad_response", text.slice(0, 300)); }
  if (!up.ok) return json(up.status, out);

  const u = out.usage ?? {};
  const inTok = u.input_tokens ?? 0;
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  const outTok = u.output_tokens ?? 0;
  const cost = ((inTok - cached) * Number(price.in_per_m) + cached * Number(price.cached_per_m) + outTok * Number(price.out_per_m)) / 1e6;
  const [{ charge: spent }] = await sql`select mudex.charge(${row.code}, ${body.model}, ${inTok}, ${cached}, ${outTok}, ${cost})`;
  out.mudex = {
    cost_usd: Number(cost.toFixed(6)),
    spent_usd: Number(Number(spent).toFixed(4)),
    remaining_usd: Number(Math.max(0, row.budget_usd - spent).toFixed(4)),
  };
  return json(200, out);
}

// 키프레임 이미지. 연수생 힉스필드 크레딧은 영상에만 쓰도록 이미지는 강사 API로 뽑는다.
const MAX_IMAGES = 4;
async function images(req: Request) {
  const { row, err } = await loadCode(req);
  if (err) return err;
  if (Number(row.spent_usd) >= Number(row.budget_usd)) return fail(402, "budget_exhausted", `한도 ${row.budget_usd}달러를 다 썼습니다.`);

  let body: any;
  try { body = await req.json(); } catch { return fail(400, "bad_json", "요청 형식이 JSON이 아닙니다."); }
  const [price] = await sql`select * from mudex.models where model = ${body.model} and kind = 'image' and enabled`;
  if (!price) {
    const allowed = await sql`select model from mudex.models where kind = 'image' and enabled order by model`;
    return fail(400, "model_not_allowed", `허용된 이미지 모델: ${allowed.map((m: any) => m.model).join(", ")}`);
  }
  if (!OPENAI_KEY) return fail(503, "no_upstream_key", "강사가 아직 OpenAI 키를 서버에 넣지 않았습니다.");
  body.n = Math.min(Math.max(1, Number(body.n ?? 1)), MAX_IMAGES);
  delete body.stream;

  const up = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await up.text();
  let out: any;
  try { out = JSON.parse(text); } catch { return fail(502, "upstream_bad_response", text.slice(0, 300)); }
  if (!up.ok) return json(up.status, out);

  const u = out.usage ?? {};
  const textIn = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
  const imageIn = u.input_tokens_details?.image_tokens ?? 0;
  const outTok = u.output_tokens ?? 0;
  const cost = (textIn * Number(price.in_per_m) + imageIn * Number(price.img_in_per_m) + outTok * Number(price.out_per_m)) / 1e6;
  const [{ charge: spent }] = await sql`select mudex.charge(${row.code}, ${body.model}, ${textIn + imageIn}, ${0}, ${outTok}, ${cost})`;
  out.mudex = {
    cost_usd: Number(cost.toFixed(6)),
    spent_usd: Number(Number(spent).toFixed(4)),
    remaining_usd: Number(Math.max(0, row.budget_usd - spent).toFixed(4)),
  };
  return json(200, out);
}

async function adminCreate(req: Request) {
  const b = await req.json().catch(() => ({}));
  const count = Math.min(Math.max(1, Number(b.count ?? 1)), 100);
  const budget = Number(b.budget_usd ?? 3);
  const expires = b.expires_at ?? new Date(Date.now() + 7 * 864e5).toISOString();
  const rows = Array.from({ length: count }, (_, i) => ({
    code: newCode(),
    label: count > 1 ? `${b.label ?? "연수생"} ${String(i + 1).padStart(2, "0")}` : (b.label ?? "연수생"),
    budget_usd: budget,
    expires_at: expires,
  }));
  await sql`insert into mudex.codes ${sql(rows, "code", "label", "budget_usd", "expires_at")}`;
  return json(200, { codes: rows });
}

async function adminList() {
  const rows = await sql`select * from mudex.codes order by created_at, label`;
  return json(200, { codes: rows.map((r: any) => ({ code: r.code, disabled: r.disabled, last_used_at: r.last_used_at, ...summary(r) })) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const path = new URL(req.url).pathname.replace(/^.*\/mudex-relay/, "") || "/";
  try {
    if (path === "/status" && req.method === "GET") {
      const { row, err } = await loadCode(req);
      if (err) return err;
      const models = await sql`select model, kind from mudex.models where enabled order by model`;
      return json(200, {
        ...summary(row),
        upstream_ready: !!OPENAI_KEY,
        models: models.filter((m: any) => m.kind === "chat").map((m: any) => m.model),
        image_models: models.filter((m: any) => m.kind === "image").map((m: any) => m.model),
      });
    }
    if (path === "/v1/chat/completions" && req.method === "POST") return await chat(req);
    if (path === "/v1/responses" && req.method === "POST") return await responses(req);
    if (path === "/v1/images/generations" && req.method === "POST") return await images(req);
    if (path.startsWith("/admin/")) {
      if (!(await isAdmin(req))) return fail(401, "not_admin", "관리 비밀값이 맞지 않습니다.");
      if (path === "/admin/codes" && req.method === "POST") return await adminCreate(req);
      if (path === "/admin/codes" && req.method === "GET") return await adminList();
      if (path === "/admin/codes/disable" && req.method === "POST") {
        const { code } = await req.json();
        await sql`update mudex.codes set disabled = true where code = ${String(code).toUpperCase()}`;
        return json(200, { ok: true });
      }
    }
    return fail(404, "not_found", `없는 경로: ${req.method} ${path}`);
  } catch (e) {
    console.error(e);
    return fail(500, "server_error", String((e as Error).message ?? e).slice(0, 300));
  }
});
