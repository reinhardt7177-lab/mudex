// 무덱스 중계 서버 (Supabase Edge Function)
// 연수생 프로그램은 강사 코드만 들고 이 함수에 붙는다. OpenAI 키는 함수 비밀값(OPENAI_API_KEY)에만 있다.
//
//   GET  /status                      (Authorization: Bearer <강사 코드>)  남은 한도·만료일
//   POST /v1/chat/completions         (Authorization: Bearer <강사 코드>)  OpenAI로 전달, 사용량만큼 차감
//   POST /v1/responses                (Authorization: Bearer <강사 코드>)  Responses API(추론+도구), 사용량만큼 차감
//   POST /v1/images/generations       (Authorization: Bearer <강사 코드>)  이미지 생성, 사용량만큼 차감
//   POST /join                        {entry_code, name, device_id}  연수 코드로 들어와 개인 코드를 자동으로 받는다
//   /teacher/…                        (x-admin-password)  강사 화면: 연수 만들기·목록·연수생·연수 끝내기(코드 폐기)·강사용 코드
//   POST /admin/codes                 (x-admin-secret)  코드 발급 {count, budget_usd, expires_at, label}
//   GET  /admin/codes                 (x-admin-secret)  코드별 사용 현황
//   POST /admin/codes/disable         (x-admin-secret)  {code} 코드 끄기

import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const MAX_OUTPUT_TOKENS = 16000; // 한 번 호출로 한도를 크게 넘지 않게 묶는다
const TRAINEE_BUDGET_USD = 5; // 연수생 한 명이 쓸 수 있는 AI 비용(달러)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-admin-secret, x-admin-password",
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
  if (row.disabled) return { err: row.cohort_id ? fail(403, "cohort_closed", "연수가 끝나 이 코드는 폐기되었습니다.") : fail(403, "disabled", "강사가 이 코드를 껐습니다.") };
  if (new Date(row.expires_at) < new Date()) return { err: fail(403, "expired", `코드가 만료되었습니다 (${row.expires_at.toISOString().slice(0, 10)}).`) };
  if (row.cohort_id) {
    const [c] = await sql`select c.*, (select coalesce(sum(spent_usd), 0) from mudex.codes where cohort_id = c.id) as cohort_spent from mudex.cohorts c where c.id = ${row.cohort_id}`;
    if (!c || c.closed || new Date(c.ends_at) < new Date()) return { err: fail(403, "cohort_closed", "연수가 끝나 이 코드는 폐기되었습니다.") };
    if (c.budget_usd != null && Number(c.cohort_spent) >= Number(c.budget_usd)) return { err: fail(402, "cohort_budget", "이번 연수 전체 사용 한도에 닿았습니다. 강사님께 알려 주세요.") };
    row.cohort = { name: c.name, ends_at: c.ends_at };
  }
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
  // 인터넷 검색(web_search)은 토큰과 별도로 한 번에 1센트
  const searches = (out.output ?? []).filter((o: any) => o.type === "web_search_call").length;
  const cost = ((inTok - cached) * Number(price.in_per_m) + cached * Number(price.cached_per_m) + outTok * Number(price.out_per_m)) / 1e6 + searches * 0.01;
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

// ---------- 연수 입장 ----------
const ENTRY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newEntryCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return [...b].map((x) => ENTRY_ALPHABET[x % ENTRY_ALPHABET.length]).join("");
}

async function join(req: Request) {
  const b = await req.json().catch(() => ({}));
  const entry = String(b.entry_code ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  const name = String(b.name ?? "").trim().slice(0, 20);
  const device = String(b.device_id ?? "").slice(0, 64) || null;
  if (!entry) return fail(400, "no_entry", "연수 코드를 넣어 주세요.");
  if (!name) return fail(400, "no_name", "이름을 넣어 주세요.");
  const [c] = await sql`select * from mudex.cohorts where entry_code = ${entry}`;
  if (!c) return fail(404, "bad_entry", "없는 연수 코드입니다. 다시 확인해 주세요.");
  if (c.closed || new Date(c.ends_at) < new Date()) return fail(403, "cohort_closed", "이 연수는 끝났습니다.");
  if (device) {
    const [mine] = await sql`select code from mudex.codes where cohort_id = ${c.id} and device_id = ${device} and not disabled`;
    if (mine) {
      await sql`update mudex.codes set trainee_name = ${name}, label = ${name} where code = ${mine.code}`;
      return json(200, { code: mine.code, cohort: { name: c.name, ends_at: c.ends_at }, again: true });
    }
  }
  const code = newCode();
  // 연수생 한 명당 한도(달러)와 연수 전체 안전선을 함께 둔다. 코드는 연수가 끝나는 시각에 함께 끝난다.
  await sql`insert into mudex.codes (code, label, budget_usd, expires_at, cohort_id, trainee_name, device_id)
            values (${code}, ${name}, ${TRAINEE_BUDGET_USD}, ${c.ends_at}, ${c.id}, ${name}, ${device})`;
  return json(200, { code, cohort: { name: c.name, ends_at: c.ends_at } });
}

// ---------- 강사(공용 비밀번호) ----------
async function isTeacher(req: Request) {
  const given = req.headers.get("x-admin-password");
  if (!given) return false;
  const [row] = await sql`select value from mudex.config where key = 'admin_password_sha256'`;
  const ok = !!row && row.value === (await sha256Hex(given));
  if (!ok) await new Promise((r) => setTimeout(r, 800)); // 마구 넣어 보기 늦추기
  return ok;
}

async function teacher(req: Request, path: string) {
  if (!(await isTeacher(req))) return fail(401, "not_teacher", "강사 비밀번호가 맞지 않습니다.");
  if (path === "/teacher/login") return json(200, { ok: true });
  if (path === "/teacher/cohorts" && req.method === "GET") {
    const rows = await sql`select c.*, (select count(*) from mudex.codes where cohort_id = c.id) as trainees,
      (select coalesce(sum(spent_usd), 0) from mudex.codes where cohort_id = c.id) as spent
      from mudex.cohorts c order by c.created_at desc limit 50`;
    return json(200, { cohorts: rows.map((r: any) => ({ ...r, trainees: Number(r.trainees), spent: Number(Number(r.spent).toFixed(4)), budget_usd: r.budget_usd == null ? null : Number(r.budget_usd), open: !r.closed && new Date(r.ends_at) > new Date() })) });
  }
  if (path === "/teacher/cohorts" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name ?? "").trim().slice(0, 40) || "연수";
    const ends = b.ends_at ? new Date(b.ends_at) : new Date(Date.now() + 8 * 3600e3);
    if (isNaN(+ends) || ends < new Date()) return fail(400, "bad_time", "끝나는 시각이 지났습니다.");
    const budget = b.budget_usd === null || b.budget_usd === "" || b.budget_usd === undefined ? null : Number(b.budget_usd);
    for (let i = 0; i < 5; i++) {
      const entry = newEntryCode();
      try {
        const [c] = await sql`insert into mudex.cohorts (name, entry_code, ends_at, budget_usd) values (${name}, ${entry}, ${ends.toISOString()}, ${budget}) returning *`;
        return json(200, { cohort: c });
      } catch (e) { if (!String(e).includes("duplicate")) throw e; }
    }
    return fail(500, "entry_code", "연수 코드를 만들지 못했습니다.");
  }
  let m = path.match(/^\/teacher\/cohorts\/([0-9a-f-]{36})$/);
  if (m && req.method === "GET") {
    const [c] = await sql`select * from mudex.cohorts where id = ${m[1]}`;
    if (!c) return fail(404, "no_cohort", "없는 연수입니다.");
    const codes = await sql`select code, trainee_name, spent_usd, last_used_at, disabled, created_at from mudex.codes where cohort_id = ${m[1]} order by created_at`;
    return json(200, { cohort: { ...c, budget_usd: c.budget_usd == null ? null : Number(c.budget_usd), open: !c.closed && new Date(c.ends_at) > new Date() },
      trainees: codes.map((r: any) => ({ code: r.code, name: r.trainee_name, spent: Number(Number(r.spent_usd).toFixed(4)), last_used_at: r.last_used_at, disabled: r.disabled, joined_at: r.created_at })) });
  }
  m = path.match(/^\/teacher\/cohorts\/([0-9a-f-]{36})\/close$/);
  if (m && req.method === "POST") {
    // 연수 끝내기: 연수를 닫고 그 연수의 코드를 모두 폐기한다
    await sql`update mudex.cohorts set closed = true where id = ${m[1]}`;
    const r = await sql`update mudex.codes set disabled = true where cohort_id = ${m[1]} returning code`;
    return json(200, { ok: true, disabled: r.length });
  }
  m = path.match(/^\/teacher\/cohorts\/([0-9a-f-]{36})\/budget$/);
  if (m && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const budget = b.budget_usd === null || b.budget_usd === "" ? null : Number(b.budget_usd);
    await sql`update mudex.cohorts set budget_usd = ${budget} where id = ${m[1]}`;
    return json(200, { ok: true });
  }
  if (path === "/teacher/codes/disable" && req.method === "POST") {
    const { code } = await req.json();
    await sql`update mudex.codes set disabled = true where code = ${String(code).toUpperCase()}`;
    return json(200, { ok: true });
  }
  if (path === "/teacher/self-code" && req.method === "POST") {
    // 강사가 무덱스를 직접 쓸 코드(연수와 별개, 60일)
    const [mine] = await sql`select code from mudex.codes where label = '강사' and cohort_id is null and not disabled and expires_at > now() order by created_at desc limit 1`;
    if (mine) return json(200, { code: mine.code });
    const code = newCode();
    await sql`insert into mudex.codes (code, label, budget_usd, expires_at) values (${code}, '강사', 50, ${new Date(Date.now() + 60 * 864e5).toISOString()})`;
    return json(200, { code });
  }
  return fail(404, "not_found", `없는 경로: ${req.method} ${path}`);
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
        cohort: row.cohort ?? null,
        trainee_name: row.trainee_name ?? null,
        upstream_ready: !!OPENAI_KEY,
        models: models.filter((m: any) => m.kind === "chat").map((m: any) => m.model),
        image_models: models.filter((m: any) => m.kind === "image").map((m: any) => m.model),
      });
    }
    if (path === "/join" && req.method === "POST") return await join(req);
    if (path.startsWith("/teacher/")) return await teacher(req, path);
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
