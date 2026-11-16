// 무덱스 화면(웹판). /api와 실시간 이벤트는 backend.js가 브라우저 안에서 받아 처리한다.
import { ready, openLocalFolder, grantFolder, fileBlob } from "./backend.js";
await ready;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtS = (s) => (s == null ? "" : `${Number(s).toFixed(s % 1 ? 3 : 0)}s`);
const USD_KRW_RATE = 1335; // 표시용 참고 환율, 2026-11-16 기준
const enc = (rel) => rel.split("/").map(encodeURIComponent).join("/");
const fileUrl = (rel) => `/f/${encodeURIComponent(S.jobId)}/${enc(rel)}`;
const thumbUrl = (rel) => `/thumb/${encodeURIComponent(S.jobId)}/${enc(rel)}`;
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `오류 ${r.status}`);
  return j;
};
function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), ms);
}


// 선 아이콘 한 벌(16px, 1.6 선). 이모지·색 상자 대신 쓴다.
const ICON_PATHS = {
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M12 15h5"/>',
  down: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  up: '<path d="M12 20V9"/><path d="M7 14l5-5 5 5"/><path d="M5 4h14"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  cut: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.4L20 18M8.2 15.6L20 6"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  gauge: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/>',
  join: '<rect x="3" y="7" width="8" height="10" rx="1.5"/><rect x="13" y="7" width="8" height="10" rx="1.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
const icon = (k, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k] ?? ""}</svg>`;

const S = { st: null, jobId: new URLSearchParams(location.search).get("job") ?? localStorage.getItem("mudex.job"), job: null, es: null, tab: "preview", cards: new Map(), plan: null, runCost: 0, gens: new Map(), sheet: null, verify: null, running: false, lastTrimCard: null, term: [], previewFile: null };

// ---------- 왼쪽 ----------
// 프로젝트 줄의 ⋯ 메뉴: 대화 지우기(파일은 남김) · 프로젝트 삭제
function jobMenu(btn, j) {
  document.querySelector(".jmenu")?.remove();
  const m = document.createElement("div");
  m.className = "jmenu"; m.setAttribute("role", "menu");
  m.innerHTML = `<button role="menuitem" data-a="clear">대화 지우기<span>파일은 남겨요</span></button>
    <button role="menuitem" data-a="del" class="danger">${j.local ? "목록에서 빼기" : "프로젝트 삭제"}<span>${j.local ? "PC 폴더의 파일은 남아요" : "파일까지 모두 지워요"}</span></button>`;
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, window.innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)}px`;
  const close = () => { m.remove(); document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", esc2, true); };
  const out = (e) => { if (!m.contains(e.target)) close(); };
  const esc2 = (e) => { if (e.key === "Escape") { close(); btn.focus(); } };
  document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", esc2, true);
  $("button", m).focus();
  m.onclick = async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (!a) return;
    close();
    const id = encodeURIComponent(j.id);
    try {
      if (a === "clear") {
        if (!confirm(`'${j.name}'의 대화를 지울까요?\n대화 기록과 무덱스의 기억이 지워집니다. 만든 파일은 그대로 남습니다.`)) return;
        await api("POST", `/api/jobs/${id}/clear`);
        if (S.jobId === j.id) await openJob(j.id);
        toast("대화를 지웠어요. 파일은 그대로 있어요.");
      } else {
        if (!confirm(j.local ? `'${j.name}'을 목록에서 뺄까요?\nPC 폴더와 그 안의 파일은 지워지지 않습니다.` : `'${j.name}' 프로젝트를 삭제할까요?\n대화와 파일이 모두 지워지고 되돌릴 수 없습니다. 필요한 파일은 먼저 '프로젝트 내려받기(zip)'로 받아 두세요.`)) return;
        await api("DELETE", `/api/jobs/${id}`);
        if (S.jobId === j.id) { S.es?.close(); S.jobId = null; S.job = null; S.running = false; S.plan = null; localStorage.removeItem("mudex.job"); renderPlan(); renderTop(); renderSend(); renderFoot(); }
        await refreshState();
        toast(j.local ? "목록에서 뺐어요." : "프로젝트를 삭제했어요.");
      }
    } catch (err) { toast(err.message, 5000); }
  };
}
function renderSide() {
  const st = S.st;
  const jobs = st?.jobs ?? [];
  const today = new Date().toDateString();
  const groups = { 오늘: [], 이전: [] };
  for (const j of jobs) (new Date(j.updated).toDateString() === today ? groups.오늘 : groups.이전).push(j);
  $("#jobs").innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `
    <div><div class="group-t">${k}</div>${v.map((j) => `
      <div class="job ${j.id === S.jobId ? "on" : ""}" data-id="${esc(j.id)}">
        ${j.thumb ? `<img src="/thumb/${encodeURIComponent(j.id)}/${enc(j.thumb)}" alt="">` : `<span class="ph">${icon("folder")}</span>`}
        <span class="nm">${esc(j.name)}</span>${j.local ? `<span class="tagpc" title="${j.needs_permission ? "다시 허용이 필요한 PC 폴더" : "내 PC 폴더"}">${j.needs_permission ? "허용 필요" : "PC"}</span>` : ""}${j.id === S.jobId && S.running ? `<span class="dot"></span>` : ""}
        <button class="jmore" data-more title="대화 지우기·삭제" aria-label="${esc(j.name)} 더 보기" aria-haspopup="menu">⋯</button>
      </div>`).join("")}</div>`).join("") || `<div class="muted" style="padding:0 10px">아직 작업이 없어요.</div>`;
  for (const el of document.querySelectorAll(".job")) el.onclick = (e) => {
    if (e.target.closest("[data-more]")) return jobMenu(e.target.closest("[data-more]"), jobs.find((j) => j.id === el.dataset.id));
    openJob(el.dataset.id);
  };

  const hf = st?.hf ?? {};
  const rl = st?.relay;
  const hfRow = hf.logged_in
    ? `<div class="conn-row"><span class="led ${hf.error ? "warn" : ""}"></span><span>힉스필드</span><span class="v">${hf.credits != null ? `${hf.credits} 크레딧` : `<span style="color:var(--muted);font-weight:400">확인 중</span>`}</span>
       <div class="meter"><i style="width:${Math.min(100, ((hf.credits ?? 0) / 200) * 100)}%;background:var(--violet)"></i></div></div>`
    : `<div class="conn-row"><span class="led off"></span><span>힉스필드</span><span class="act" id="hfLogin">${hf.logging_in ? "연결 중…" : "연결하기"}</span></div>`;
  const codeRow = !st?.code_set
    ? `<div class="conn-row"><span class="led off"></span><span>연수</span><span class="act" id="setCode">들어가기</span></div>`
    : rl?.error
      ? `<div class="conn-row"><span class="led warn"></span><span>연수</span><span class="act" id="setCode">다시 들어가기</span></div><div class="conn-foot"><span style="color:var(--amber)">${esc(rl.error)}</span></div>`
      : !rl ? `<div class="conn-row"><span class="led off"></span><span>연수</span><span class="v" style="color:var(--muted);font-weight:400">확인 중</span></div>`
      : rl.cohort ? `<div class="conn-row"><span class="led"></span><span>연수</span><span class="v">${esc(rl.cohort.name)}</span></div>
         <div class="conn-foot"><span>${esc(rl.trainee_name ?? st.name ?? "")}</span><span>${new Date(rl.cohort.ends_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지</span></div>`
      : `<div class="conn-row"><span class="led"></span><span>강사 코드</span><span class="v">$${(rl?.remaining_usd ?? 0).toFixed(2)} 남음</span>
         <div class="meter"><i style="width:${rl ? (rl.remaining_usd / rl.budget_usd) * 100 : 0}%;background:var(--mint)"></i></div></div>
         <div class="conn-foot"><span class="mono">${esc(st.code_hint)}</span><span>${rl?.expires_at ? new Date(rl.expires_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) + "까지" : ""}</span></div>`;
  $("#conn").innerHTML = hfRow + codeRow;
  $("#hfLogin")?.addEventListener("click", () => openConnectors());
  $("#setCode")?.addEventListener("click", () => showEntry());
}

async function hfLogin() {
  try {
    await api("POST", "/api/hf/login");
    toast("브라우저에서 힉스필드에 로그인하고 '허용'을 눌러 주세요.", 5000);
    S.st.hf.logging_in = true; renderSide();
  } catch (e) { toast(e.message); }
}

function modal({ title, text, placeholder, value = "", ok = "확인", onOk }) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ""}<input value="${esc(value)}" placeholder="${esc(placeholder ?? "")}"><div class="msg"></div>
    <div class="acts"><button class="btn ghost">취소</button><button class="btn pri">${esc(ok)}</button></div></div>`;
  document.body.append(m);
  const inp = $("input", m), msg = $(".msg", m);
  inp.focus(); inp.select();
  const close = () => m.remove();
  const go = async () => { msg.textContent = ""; try { await onOk(inp.value); close(); } catch (e) { msg.textContent = e.message; } };
  $(".ghost", m).onclick = close;
  $(".pri", m).onclick = go;
  inp.onkeydown = (e) => { if (e.key === "Enter") go(); if (e.key === "Escape") close(); };
}

function newJob() {
  modal({
    title: "새 프로젝트", text: "프로젝트 이름을 정해 주세요. 프로젝트마다 폴더가 하나씩 생기고, 무덱스는 그 폴더 안에서만 일합니다.", placeholder: "예) 우리 반 퀴즈, 자리 바꾸기", ok: "만들기",
    onOk: async (v) => { const { id } = await api("POST", "/api/jobs", { name: v }); await refreshState(); openJob(id); },
  });
}

// ---------- 가운데 ----------
function renderTop() {
  if (!S.job) { $("#top").innerHTML = `<h1>새로 시작</h1><span class="sp"></span>`; return; }
  const files = S.job.files ?? [];
  const nv = files.filter((f) => f.kind === "video").length, nh = files.filter((f) => f.kind === "html").length;
  $("#top").innerHTML = `<h1>${esc(S.jobId)}</h1><span class="path">${esc(S.job.dir)}</span><span class="sp"></span>
    <span class="pill">파일 ${files.length}${nh ? ` · 웹페이지 ${nh}` : ""}${nv ? ` · 영상 ${nv}` : ""}</span>
    ${S.running ? `<span class="pill violet">● 작업 중</span>` : `<span class="pill mint">● 대기</span>`}`;
}

function renderEmpty() {
  renderTop();
  $("#feed").innerHTML = `<div class="col"><div class="welcome">
    <h2>말로 시키면, 무덱스가 만듭니다</h2>
    <p>파일을 만들고 고치고, 직접 열어 확인합니다. 커넥터(MCP)로 힉스필드를 붙이면 영상까지 만듭니다.</p>
    <div class="welcome-foot"><button class="btn" id="exNew">${icon("plus", 14)} 새 프로젝트</button>${S.st?.can_pick_folder ? `<button class="btn ghost" id="exFolder">${icon("folder", 14)} 내 PC 폴더 열기</button>` : ""}<span class="muted">또는 아래 입력창에 바로 적어 보내세요.</span></div>
  </div></div>`;
  $("#exNew").onclick = newJob;
  $("#exFolder")?.addEventListener("click", () => openFolder());
}
function renderStart(rb) {
  const st = S.st ?? {};
  const codeOk = st.code_set && st.relay && !st.relay.error;
  const hfOk = !!st.hf?.logged_in;
  const row = (ok, title, sub, act, id) => `<div class="ckrow ${ok ? "ok" : ""}"><span class="ck">${ok ? icon("check", 12) : ""}</span><div><div class="ckt">${title}</div><div class="cks">${sub}</div></div>${!ok && act ? `<button class="btn" id="${id}">${act}</button>` : ""}</div>`;
  rb.innerHTML = `<div class="sec-t">시작하기</div>
    <div class="cklist">
      ${row(codeOk, st.relay?.cohort ? "연수 입장" : "강사 코드", codeOk ? (st.relay.cohort ? `${st.relay.cohort.name} · ${st.relay.trainee_name ?? ""}` : `남은 한도 $${st.relay.remaining_usd.toFixed(2)}`) : "연수 코드로 들어와요", "들어가기", "ckCode")}
      ${row(hfOk, "힉스필드 커넥터", hfOk ? `${st.hf.credits ?? "?"} 크레딧 · MCP 도구 185개` : "영상을 만들 때 연결해요(MCP · OAuth)", "연결", "ckHf")}
      ${row((st.jobs ?? []).length > 0, "첫 프로젝트", (st.jobs ?? []).length ? `${st.jobs.length}개 있음` : "입력창에 하고 싶은 걸 적어 보세요", "", "")}
    </div>
    <div class="sec-t">무덱스가 쓰는 도구</div>
    <div class="toolwell">
      ${[["pen", "파일 쓰기·고치기", "브라우저 저장소 또는 내 PC 폴더"], ["eye", "페이지 열어 확인", "오류·버튼·그림 검사"], ["term", "코드 실행", "샌드박스, 허락 후 실행"], ["image", "그림 그리기", "크레딧 0"], ["plug", "커넥터(MCP)", "찾기 → 설명 → 부르기"]].map(([k, a, b]) => `<div class="tw">${icon(k)}<span>${a}</span><span class="r">${b}</span></div>`).join("")}
    </div>
    <div class="muted">새 프로젝트는 이 브라우저에 저장됩니다. 왼쪽 위 <b>내 PC 폴더 열기</b>로 고른 폴더는 PC에 바로 저장됩니다.</div>`;
  $("#ckCode")?.addEventListener("click", () => showEntry());
  $("#ckHf")?.addEventListener("click", () => openConnectors());
}

// 짧은 마크다운만: 굵게, 코드, 링크(작업 폴더 파일이면 재생·보기)
// 무덱스 답에 자주 나오는 표·목록·제목만 보기 좋게 바꾼다(나머지 줄은 그대로)
function mdBlocks(t) {
  const out = []; let rows = null;
  const flush = () => {
    if (!rows) return;
    if (rows.length) out.push(`<table class="mdt">${rows.map((r, i) => `<tr>${r.map((c) => `<${i ? "td" : "th"}>${c}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`);
    rows = null;
  };
  for (const line of t.split("\n")) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      rows ??= [];
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) rows.push(line.trim().slice(1, -1).split("|").map((c) => c.trim())); // 구분 줄(|---|)은 뺀다
      continue;
    }
    flush();
    out.push(line.replace(/^(\s*)#{1,4}\s+(.*)$/, '$1<b class="mdh">$2</b>').replace(/^(\s*)[-*]\s+/, "$1• "));
  }
  flush();
  return out.join("\n");
}
const md = (t) => mdBlocks(esc(t))
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => /^https?:/.test(href)
    ? `<a href="${href}" target="_blank" style="color:var(--mint)">${label}</a>`
    : /\.(mp4|mov|webm)$/i.test(href) ? `<a href="#" data-play="${href}" style="color:var(--mint)">▶ ${label}</a>`
    : `<a href="#" data-zoom="${fileUrl(href)}" style="color:var(--mint)">${label}</a>`);

const TOOL_META = {
  list_files: ["list", "파일 보기"], read_file: ["eye", "읽기"], write_file: ["pen", "파일 쓰기"], edit_file: ["pen", "고치기"],
  run_command: ["term", "명령 실행"], run_js: ["term", "코드 실행"], check_page: ["eye", "페이지 열어 확인"], download_file: ["down", "내려받기"], upload_file: ["up", "올리기"], make_image: ["image", "그림 그리기"],
  web_search: ["search", "인터넷 검색"], mcp_list_tools: ["search", "커넥터 도구 찾기"], mcp_describe: ["plug", "도구 설명 보기"], mcp_call: ["plug", "커넥터 도구 부르기"],
  list_clips: ["film", "클립 살펴보기"], probe: ["gauge", "길이 재기"], trim: ["cut", "자르기"], concat: ["join", "이어 붙이기"],
  add_music: ["music", "음악 얹기"], export_final: ["down", "내보내기"], measure: ["gauge", "결과 재기"], run_ffmpeg: ["film", "영상 편집(ffmpeg)"],
  higgsfield_clip: ["film", "힉스필드로 영상 만들기"], review_sheet: ["grid", "8fps 검수 시트"],
};
const SILENT_TOOLS = new Set(["update_plan", "ask_user", "set_plan", "ask_pick"]);

function toolSummary(name, a = {}) {
  switch (name) {
    case "list_files": return a.path || "프로젝트 전체";
    case "read_file": case "write_file": case "edit_file": return a.path;
    case "run_command": case "run_js": return a.why ?? "";
    case "check_page": return a.path;
    case "download_file": return `→ ${a.path}`;
    case "upload_file": return a.path;
    case "make_image": return `이미지 생성 · ${a.count ?? 1}장 · 크레딧 0`;
    case "web_search": return `"${a.query ?? ""}"`;
    case "mcp_list_tools": return `${a.connector ?? "전체"}${a.query ? ` · "${a.query}"` : ""}`;
    case "mcp_describe": case "mcp_call": return `${a.connector ?? ""} · ${a.tool}`;
    case "trim": return `${a.input} · ${Number(a.start).toFixed(2)} → ${Number(a.end).toFixed(2)}`;
    case "concat": return `${(a.inputs ?? []).length}개 → ${a.output}`;
    case "add_music": return `${a.music}${a.fade_out ? ` · 끝 ${a.fade_out}초 페이드` : ""}`;
    case "run_ffmpeg": return `${(a.inputs ?? []).join(", ")} → ${a.output}`;
    case "export_final": return `${a.output}${a.duration ? ` · ${a.duration}초` : ""} · 음량 ${a.target_lufs ?? -14} LUFS`;
    case "measure": case "probe": return a.file;
    case "higgsfield_clip": return `${a.model ?? "kling2_6"} · ${a.duration ?? 5}초 · ${a.start_image}`;
    case "review_sheet": return `${a.file} · ${a.start}s부터 ${a.seconds ?? 1}초`;
    default: return "";
  }
}

function addEl(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html.trim();
  const el = wrap.firstChild;
  $(".col", $("#feed")).append(el);
  return el;
}

function scrollFeed() { const f = $("#feed"); f.scrollTop = f.scrollHeight; }

function renderEvent(e, live) {
  const col = $(".col", $("#feed"));
  if (!col) return;
  $(".thinking", col)?.remove();
  if (e.type !== "tool_result" && e.type !== "cost" && e.type !== "gen" && e.type !== "plan") S.lastTrimCard = e.type === "tool_call" && e.name === "trim" ? S.lastTrimCard : null;
  switch (e.type) {
    case "user": S.runCost = 0; S.plan = null; renderPlan(); $(".hint", col)?.remove(); addEl(`<div class="you">${esc(e.text)}</div>`); break;
    case "assistant": addEl(`<div class="say">${md(e.text)}</div>`); break;
    case "plan": S.plan = e; renderPlan(); break;
    case "cost": S.runCost += e.cost_usd ?? 0; if (e.remaining_usd != null && S.st?.relay) S.st.relay.remaining_usd = e.remaining_usd; renderFoot(); break;
    case "tool_call": renderToolCall(e); break;
    case "tool_result": renderToolResult(e); updGroup(S.cards.get(e.id)?.card?.closest(".tgroup")); break;
    case "ask": renderAsk(e, live); break;
    case "answer": markAnswered(e); break;
    case "gen": updateGen(e); break;
    case "term": S.term.push(e); if (S.tab === "term") renderRight(); break;
    case "file_changed": S.previewFile = e.path; if (live) { clearTimeout(S.fcT); S.fcT = setTimeout(() => refreshJob().then(() => { if (S.tab !== "term") setTab("preview"); }), 400); } break;
    case "sheet": S.sheet = e; renderSheet(e); if (live) setTab("review"); break;
    case "done": S.verify = e.verify; renderDone(e); if (live) { refreshJob().then(() => setTab("preview")); } break;
    case "error": addEl(/^멈췄습니다/.test(e.message) ? `<div class="say muted">멈췄어요. 만든 파일은 그대로 있어요. 이어서 하려면 아래에 적어 주세요.</div>` : `<div class="errcard">${esc(e.message)}</div>`); break;
    case "status": S.running = e.running; if (!e.running) closeAsks(); renderTop(); renderSend(); renderSide(); break;
  }
  if (S.running && live) showBusy();
  if (live) scrollFeed();
}

function renderToolCall(e) {
  if (S.cards.has(e.id)) return;
  // set_plan은 아래 할 일 목록으로, ask_pick은 고르기 카드로 보여 주므로 따로 카드를 만들지 않는다
  if (SILENT_TOOLS.has(e.name)) return;
  const [ick, nm] = TOOL_META[e.name] ?? ["file", e.name];
  const ic = icon(ick);
  if (e.name === "trim") {
    if (!S.lastTrimCard) {
      S.lastTrimCard = addEl(`<div class="tool"><div class="tool-h"><span class="ic">${ic}</span><span class="nm">자르기</span><span class="fn">trim</span><span class="st"><span class="spin"></span></span></div><div class="tool-b rows"></div></div>`);
      S.lastTrimCard.count = 0;
    }
    S.lastTrimCard.count++;
    $(".nm", S.lastTrimCard).textContent = `자르기 ${S.lastTrimCard.count}번`;
    $(".fn", S.lastTrimCard).textContent = `trim × ${S.lastTrimCard.count}`;
    const row = document.createElement("div");
    row.innerHTML = `<img src="${thumbUrl(e.args.input)}" alt="" onerror="this.style.visibility='hidden'">${esc(e.args.input)} <span>${Number(e.args.start).toFixed(2)} → ${Number(e.args.end).toFixed(2)}</span><span class="r"><span class="spin"></span></span>`;
    $(".rows", S.lastTrimCard).append(row);
    S.cards.set(e.id, { card: S.lastTrimCard, row });
    return;
  }
  const html = `<div class="tool"><div class="tool-h"><span class="ic">${ic}</span><span class="nm">${esc(nm)}</span><span class="fn">${esc(toolSummary(e.name, e.args))}</span><span class="st"><span class="spin"></span></span></div></div>`;
  let card;
  if (isQuiet(e)) { const g = quietGroup(); $(".gb", g).insertAdjacentHTML("beforeend", html); card = $(".gb", g).lastElementChild; }
  else card = addEl(html);
  if (e.name === "run_command" || e.name === "run_js") card.insertAdjacentHTML("beforeend", `<div class="tool-b"><pre class="termblk">${e.name === "run_js" ? "" : "$ "}${esc(e.args.command ?? e.args.code)}</pre></div>`);
  if (["write_file", "edit_file", "read_file", "check_page"].includes(e.name)) { card.dataset.preview = e.args.path; card.style.cursor = "pointer"; }
  S.cards.set(e.id, { card, args: e.args });
  updGroup(card.closest(".tgroup"));
}

// 조회·읽기·쓰기 같은 과정은 한 줄로 접고(눌러서 펼치기), 설명과 결과(그림·질문·생성)만 펼쳐 보인다
const LOUD_TOOLS = new Set(["make_image", "higgsfield_clip", "trim", "concat", "add_music", "export_final", "run_ffmpeg", "review_sheet"]);
function isQuiet(e) {
  if (LOUD_TOOLS.has(e.name)) return false;
  if (e.name === "mcp_call" && /^(generate|create|upscale|remove_background|reframe|outpaint|motion_control|dubbing|voice_change|execute_preset)/.test(e.args?.tool ?? "")) return false;
  return true;
}
function quietGroup() {
  const col = $(".col", $("#feed"));
  const last = col.lastElementChild;
  if (last?.classList.contains("tgroup")) return last;
  return addEl(`<details class="tgroup"><summary><span class="gst"><span class="spin"></span></span><span class="gt"></span><span class="gn"></span></summary><div class="gb"></div></details>`);
}
function updGroup(g) {
  if (!g) return;
  const cards = [...$(".gb", g).children];
  const busy = cards.filter((c) => $(".st .spin", c));
  const bad = cards.filter((c) => c.classList.contains("err")).length;
  const now = busy.at(-1) ?? cards.at(-1);
  $(".gt", g).textContent = busy.length ? `${$(".nm", now).textContent} · ${$(".fn", now).textContent}` : `과정 ${cards.length}단계`;
  $(".gn", g).textContent = busy.length ? `${cards.length}단계째` : bad ? `실패 ${bad}` : "펼쳐 보기";
  $(".gst", g).innerHTML = busy.length ? `<span class="spin"></span>` : bad ? `<span style="color:var(--amber)">!</span>` : `<span class="ok">${icon("check", 12)}</span>`;
  g.classList.toggle("bad", !busy.length && bad > 0);
}

function renderToolResult(e) {
  if (SILENT_TOOLS.has(e.name)) return;
  const ref = S.cards.get(e.id);
  if (!ref) return;
  const { card, row } = ref;
  const r = e.result ?? {};
  const secs = e.ms != null ? `${(e.ms / 1000).toFixed(1)}초` : "";
  if (!e.ok && /^(멈췄습니다|사용자가 멈췄습니다)/.test(r.error ?? "")) { if (row) $(".r", row).textContent = "멈춤"; $(".st", card).innerHTML = `<span class="muted">멈춤</span>`; return; }
  if (!e.ok) {
    card.classList.add("err");
    if (row) $(".r", row).innerHTML = `<span style="color:var(--red)">실패</span>`;
    $(".st", card).innerHTML = "실패";
    card.insertAdjacentHTML("beforeend", `<div class="tool-b errtxt">${esc(r.error)}</div>`);
    return;
  }
  if (row) {
    $(".r", row).innerHTML = `<span class="ok">${fmtS(r.duration)}</span>`;
    const pending = $(".rows", card).querySelectorAll(".spin").length;
    $(".st", card).innerHTML = pending ? `<span class="spin"></span>` : `<span class="ok">${icon("check", 12)}</span>`;
    return;
  }
  let st = `<span class="ok">${icon("check", 12)}</span> ${secs}`;
  if (["concat", "add_music", "export_final", "measure", "probe"].includes(e.name) && r.duration != null) {
    st = `<span class="ok">${icon("check", 12)}</span> ${r.width ?? ""}${r.width ? "×" : ""}${r.height ?? ""} · ${r.fps ?? ""}fps · ${Number(r.duration).toFixed(3)}s`;
    if (r.loudness) st += ` · ${r.loudness.integrated_lufs} LUFS`;
  }
  $(".st", card).innerHTML = st;
  if (e.name === "list_clips") {
    const items = [...(r.videos ?? []).map((v) => ({ f: v.file, cap: `${v.file.split("/").pop().slice(0, 10)} · ${Number(v.duration).toFixed(1)}s` })), ...(r.images ?? []).slice(0, 6).map((f) => ({ f, cap: f.split("/").pop().slice(0, 12) }))];
    if (items.length) card.insertAdjacentHTML("beforeend", `<div class="tool-b"><div class="strip" style="grid-template-columns:repeat(${Math.min(6, Math.max(3, items.length))},1fr)">${items.slice(0, 12).map((x) => `<figure><img src="${thumbUrl(x.f)}" alt=""><figcaption>${esc(x.cap)}</figcaption></figure>`).join("")}</div>${r.music?.length ? `<div class="muted" style="margin-top:8px">음악: ${r.music.map((m) => `${esc(m.file)} · ${Number(m.duration).toFixed(1)}s`).join(", ")}</div>` : ""}</div>`);
  }
  if (e.name === "write_file") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${r.created ? "새로 만듦" : "덮어씀"} · ${r.lines}줄`;
  if (e.name === "edit_file") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${r.replaced}곳 고침`;
  if (e.name === "read_file") $(".st", card).innerHTML = r.binary ? "바이너리 파일" : `<span class="ok">${icon("check", 12)}</span> ${r.total_lines}줄`;
  if (e.name === "web_search") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span>${r.sources ? ` 출처 ${r.sources}곳` : ""}`;
  if (e.name === "list_files") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${(r.files ?? []).length}개`;
  if (e.name === "download_file") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${(r.size / 1048576).toFixed(1)}MB`;
  if (e.name === "run_command") {
    if (r.approved === false) { $(".st", card).innerHTML = `<span style="color:var(--muted)">실행 안 함</span>`; }
    else {
      $(".st", card).innerHTML = r.exit_code === 0 ? `<span class="ok">${icon("check", 12)}</span> ${secs}` : `<span style="color:var(--amber)">끝남 코드 ${r.exit_code}</span>`;
      if (r.output?.trim()) $(".termblk", card).insertAdjacentText("beforeend", "\n" + r.output.trim().slice(-3000));
    }
  }
  if (e.name === "run_js") {
    if (r.approved === false) { $(".st", card).innerHTML = `<span style="color:var(--muted)">실행 안 함</span>`; }
    else {
      $(".st", card).innerHTML = r.ok ? `<span class="ok">${icon("check", 12)}</span> ${secs}` : `<span style="color:var(--amber)">오류</span>`;
      if (r.output?.trim()) $(".termblk", card).insertAdjacentText("beforeend", "\n\n" + r.output.trim().slice(-3000));
    }
  }
  if (e.name === "check_page") $(".st", card).innerHTML = r.ok ? `<span class="ok">${icon("check", 12)}</span> 오류 없음 · 버튼 ${r.buttons ?? 0}` : `<span style="color:var(--amber)">문제 ${(r.errors ?? []).length}개</span>`;
  if (e.name === "mcp_list_tools") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${(r.connectors ?? []).map((c) => `${c.connector} ${c.tools.length}/${c.total}`).join(", ") || "연결 없음"}`;
  if (e.name === "mcp_call") {
    if (r.approved === false) $(".st", card).innerHTML = `<span style="color:var(--muted)">취소함</span>`;
    else card.insertAdjacentHTML("beforeend", `<div class="tool-b"><pre class="termblk">${esc(JSON.stringify(r, null, 2).slice(0, 1200))}</pre></div>`);
  }
  if ((e.name === "make_image" || e.name === "make_keyframes") && r.files?.length) {
    if (r.model) $(".fn", card).textContent = `${r.model} · ${r.quality} · ${r.size}`;
    card.insertAdjacentHTML("beforeend", `<div class="tool-b"><div class="strip downloadable-images">${r.files.map((f, i) => `<div><figure><img src="${fileUrl(f)}" alt="" data-zoom="${fileUrl(f)}"><figcaption>${i + 1}</figcaption></figure><button type="button" class="btn video-download" data-download-image="${esc(f)}" data-download-job="${esc(S.jobId)}" aria-label="${i + 1}번 이미지 다운로드">${icon("down", 14)} 이미지 다운로드</button></div>`).join("")}</div></div>`);
    const cost = r.cost_usd ?? 0;
    $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${r.files.length}장 · 약 ${Math.round(cost * USD_KRW_RATE).toLocaleString("ko-KR")}원 ($${cost.toFixed(3)})`;
    $(".st", card).title = `원화는 1달러=${USD_KRW_RATE.toLocaleString("ko-KR")}원(2026-11-16 기준)으로 환산한 참고 금액입니다. 실제 청구는 달러 기준이며 세금·결제 수수료는 별도입니다.`;
  }
  if (e.name === "higgsfield_clip" || e.name === "generate_video") {
    if (r.approved === false) $(".st", card).innerHTML = `<span style="color:var(--muted)">취소함</span>`;
    else if (r.file) { $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> ${fmtS(r.duration)} · ${r.credits_used ?? "?"}크레딧`; card.insertAdjacentHTML("beforeend", `<div class="tool-b"><video src="${fileUrl(r.file)}" controls playsinline muted style="width:100%;border-radius:8px"></video><button type="button" class="btn video-download" data-download-video="${esc(r.file)}" data-download-job="${esc(S.jobId)}">${icon("down", 14)} 영상 다운로드</button></div>`); }
  }
  if (e.name === "ask_pick") $(".st", card).innerHTML = `<span class="ok">${icon("check", 12)}</span> 골랐음`;
}

// 일하는 중 표시. 사용자의 답을 기다릴 때는 '일하는 중'이 아니라 기다린다고 말한다
function showBusy() {
  const waiting = document.querySelector("#feed [data-ask]:not([data-done])");
  addEl(waiting ? `<div class="thinking">위 카드에서 골라 주시면 이어서 합니다</div>` : `<div class="thinking"><i></i><i></i><i></i> 무덱스가 일하는 중</div>`);
}
// 일이 끝났는데(멈춤·오류 포함) 답하지 않은 질문 카드는 더 누를 수 없게 닫는다
function closeAsks() {
  document.querySelectorAll("#feed [data-ask]:not([data-done])").forEach((card) => {
    card.dataset.done = 1;
    const acts = $(".pickacts", card) ?? $(".acts", card);
    if (acts) acts.innerHTML = `<span class="note">지난 질문</span>`;
  });
}

function renderAsk(e, live) {
  // 질문 카드는 tool_call 카드 바로 아래에 붙인다
  const activeNow = live || S.job?.running;
  if (e.kind === "pick") {
    const card = addEl(`<div class="tool" data-ask="${e.ask_id}"><div class="tool-b">
      <div class="pickq">${esc(e.question)}</div>
      ${e.files?.length ? `<div class="strip pickable" style="grid-template-columns:repeat(${Math.min(4, e.files.length)},1fr)">${e.files.map((f, i) => `<figure data-f="${esc(f)}"><img src="${/\.(mp4|mov|webm)$/i.test(f) ? thumbUrl(f) : fileUrl(f)}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join("")}</div>` : ""}
      ${e.options?.length ? `<div class="opts">${e.options.map((o) => `<button class="btn" data-opt="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
      <div class="pickacts">${e.files?.length ? `<button class="btn pri" disabled>이걸로</button><button class="btn ghost">다른 걸로 다시</button><span class="note">눌러서 고르세요</span>` : `<button class="btn ghost">직접 말하기</button>`}</div></div></div>`);
    card.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => !card.dataset.done && answer(e.ask_id, b.dataset.opt));
    if (!e.files?.length) $(".ghost", card).onclick = () => modal({ title: "어떻게 할까요?", placeholder: "하고 싶은 걸 적어 주세요", ok: "전하기", onOk: async (v) => answer(e.ask_id, v) });
    let chosen = null;
    for (const fig of card.querySelectorAll("figure")) fig.onclick = () => {
      if (card.dataset.done) return;
      card.querySelectorAll("figure").forEach((x) => { x.classList.remove("pick"); x.removeAttribute("data-n"); });
      fig.classList.add("pick"); fig.dataset.n = ""; chosen = fig.dataset.f; $(".pri", card).disabled = false;
    };
    if (e.files?.length) {
      $(".pri", card).onclick = () => chosen && answer(e.ask_id, chosen);
      $(".ghost", card).onclick = () => answer(e.ask_id, "마음에 드는 게 없어요. 다른 느낌으로 다시 만들어 주세요.");
    }
    if (!activeNow) { card.dataset.done = 1; $(".pickacts", card).innerHTML = `<span class="note">지난 질문</span>`; }
  } else if (e.kind === "approve" && e.kind2 === "command") {
    const card = addEl(`<div class="approve" data-ask="${e.ask_id}" data-k2="command">
      <div class="h">${esc(e.title)} <span class="pill">명령 허락</span></div>
      <div class="prompt" style="color:var(--text)">${esc(e.why)}</div>
      <pre class="termblk">$ ${esc(e.command)}</pre>
      <div class="acts"><button class="btn vio">실행</button><button class="btn" data-al>이번엔 계속 허락</button><button class="btn ghost">하지 마</button><span class="note">프로젝트 폴더 안에서 실행됩니다</span></div></div>`);
    $(".vio", card).onclick = () => answer(e.ask_id, "yes");
    $("[data-al]", card).onclick = () => answer(e.ask_id, "always");
    $(".ghost", card).onclick = () => answer(e.ask_id, "no");
    if (!activeNow) { card.dataset.done = 1; $(".acts", card).innerHTML = `<span class="note">지난 질문</span>`; }
  } else if (e.kind === "approve" && e.kind2 === "mcp") {
    const after = e.balance != null && e.credits != null ? ` · ${e.balance} → ${Math.round((e.balance - e.credits) * 100) / 100}` : "";
    const card = addEl(`<div class="approve" data-ask="${e.ask_id}" data-k2="mcp">
      <div class="h">${esc(e.title)} ${e.practice ? `<span class="pill amber">연습 모드</span>` : ""} <span class="pill">${e.credits != null ? "크레딧 허락 필요" : "MCP 허락"}</span></div>
      <div class="spec">
        <div><div class="k">커넥터</div><div class="v">${esc(e.connector)}</div></div>
        <div><div class="k">도구</div><div class="v">${esc(e.tool)}</div></div>
        ${e.credits != null ? `<div><div class="k">크레딧</div><div class="v" style="color:var(--amber)">${e.credits}<span style="color:var(--muted);font-weight:500">${after}</span></div></div>` : ""}
      </div>
      <div class="prompt">${esc(e.summary)}</div>
      <pre class="termblk">${esc(e.args)}</pre>
      ${e.balance != null && e.credits != null && e.balance < e.credits ? `<div class="flagnote">△ 크레딧이 모자라요. 실행하면 실패합니다.</div>` : ""}
      <div class="acts"><button class="btn vio">실행</button><button class="btn ghost">하지 마</button><span class="note">허락 없이는 바깥 서비스에서 만들거나 바꾸지 않아요</span></div></div>`);
    $(".vio", card).onclick = () => answer(e.ask_id, "yes");
    $(".ghost", card).onclick = () => answer(e.ask_id, "no");
    if (!activeNow) { card.dataset.done = 1; $(".acts", card).innerHTML = `<span class="note">지난 질문</span>`; }
  } else if (e.kind === "approve") {
    const after = e.balance != null && e.credits != null ? `· ${e.balance} → ${Math.round((e.balance - e.credits) * 100) / 100}` : "";
    const short = e.balance != null && e.credits != null && e.balance < e.credits;
    const card = addEl(`<div class="approve" data-ask="${e.ask_id}">
      <div class="h">${esc(e.title)} <span class="pill">크레딧 허락 필요</span></div>
      <div class="spec">
        <div><div class="k">모델</div><div class="v">${esc(e.model)}</div></div>
        <div><div class="k">길이</div><div class="v">${esc(e.duration)}초</div></div>
        <div><div class="k">화질</div><div class="v">${esc(e.quality)}</div></div>
        <div><div class="k">크레딧</div><div class="v" style="color:var(--amber)">${e.credits ?? "?"} <span style="color:var(--muted);font-weight:500">${after}</span></div></div>
      </div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center">
        <img src="${fileUrl(e.start_image)}" style="width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:8px" alt="">
        <div class="prompt">“${esc(e.prompt)}”</div></div>
      ${short ? `<div class="flagnote">△ 크레딧이 모자라요. 생성하면 실패합니다.</div>` : ""}
      <div class="acts"><button class="btn vio">생성하기</button><button class="btn">프롬프트 고치기</button><button class="btn ghost">취소</button><span class="note">허락 없이는 크레딧을 쓰지 않아요</span></div></div>`);
    $(".vio", card).onclick = () => answer(e.ask_id, "yes");
    $(".ghost", card).onclick = () => answer(e.ask_id, "no");
    $(".acts .btn:nth-child(2)", card).onclick = () => {
      modal({ title: "어떻게 바꿀까요?", placeholder: "예) 더 천천히, 카메라는 고정", ok: "전하기", onOk: async (v) => answer(e.ask_id, `생성하지 말고 프롬프트를 이렇게 고쳐서 다시 물어봐 주세요: ${v}`) });
    };
    if (!activeNow) { card.dataset.done = 1; $(".acts", card).innerHTML = `<span class="note">지난 질문</span>`; }
  }
}

function markAnswered(e) {
  const card = document.querySelector(`[data-ask="${e.ask_id}"]`);
  if (!card) return;
  card.dataset.done = 1;
  const t = new Date(e.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (card.classList.contains("approve")) {
    const yes = e.value === "yes" || e.value === "always";
    const k2 = card.dataset.k2;
    const yesTxt = k2 === "command" ? (e.value === "always" ? "실행함 · 이번엔 계속 허락" : "실행함") : k2 === "mcp" ? "실행함" : "생성함";
    const noTxt = k2 ? "하지 않음" : "생성 안 함";
    $(".acts", card).innerHTML = `<span class="answered ${yes ? "yes" : "no"}">${yes ? icon("check", 14) : icon("x", 14)} ${yes ? yesTxt : noTxt}</span><span class="note">${t} 답함</span>`;
  } else {
    for (const fig of card.querySelectorAll("figure")) { const on = fig.dataset.f === e.value; fig.classList.toggle("pick", on); if (on) fig.dataset.n = ""; }
    card.querySelectorAll("[data-opt]").forEach((b) => { b.disabled = true; if (b.dataset.opt === e.value) b.classList.add("pri"); });
    $(".pickacts", card).innerHTML = `<span class="note">${t} · ${card.querySelector(".pick, .opts .pri") ? "골랐어요" : esc(e.value)}</span>`;
  }
}

async function answer(askId, value) {
  try { await api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/answer`, { ask_id: askId, value }); }
  catch (e) { toast(e.message); }
}

function updateGen(e) {
  const g = { ...(S.gens.get(e.id) ?? {}), ...e };
  S.gens.set(e.id, g);
  if (S.tab === "gen") renderRight();
}

function renderSheet(e) {
  addEl(`<div class="tool"><div class="tool-h"><span class="ic">${icon("grid")}</span><span class="nm">8fps 검수 시트</span><span class="fn">${esc(e.file)} · ${e.frames[0]?.t ?? 0}s부터</span><span class="st">${e.frames.length}장</span></div>
    <div class="tool-b"><div class="sheet" style="grid-template-columns:repeat(${Math.min(8, e.frames.length)},1fr)">${e.frames.map((f) => `<figure><img src="${fileUrl(f.file)}" data-zoom="${fileUrl(f.file)}" alt=""><figcaption>${f.t.toFixed(3)}</figcaption></figure>`).join("")}</div></div></div>`);
}

function renderDone(e) {
  const v = e.verify;
  if (v) {
    const L = v.loudness;
    const okLen = true;
    addEl(`<div class="result">
      <div class="result-h">결과를 프로그램이 직접 쟀어요 <span class="pill mint">${(e.seconds ?? 0)}초 · $${(e.cost_usd ?? 0).toFixed(4)}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="k">길이</div><div class="v">${Number(v.duration).toFixed(3)}<small> 초</small></div><div class="t">${v.width}×${v.height} · ${v.fps}fps</div></div>
        <div class="kpi"><div class="k">음량</div><div class="v">${L ? L.integrated_lufs : "—"}<small> LUFS</small></div><div class="t" style="${L && Math.abs(L.integrated_lufs + 14) > 1 ? "color:var(--amber)" : ""}">유튜브 기준 −14 ${L && Math.abs(L.integrated_lufs + 14) <= 1 ? icon("check", 12) : ""}</div></div>
        <div class="kpi"><div class="k">트루피크</div><div class="v">${L ? L.true_peak_db : "—"}<small> dBTP</small></div><div class="t" style="${L && L.true_peak_db > -1 ? "color:var(--amber)" : ""}">−1 이하 ${L && L.true_peak_db <= -1 ? icon("check", 12) : ""}</div></div>
      </div>
      <div class="file">${esc(v.file)}${v.size ? ` · ${(v.size / 1048576).toFixed(1)}MB` : ""} <button class="btn" data-play="${esc(v.file)}">▶ 재생</button><button class="btn" data-download-video="${esc(v.file)}" data-download-job="${esc(S.jobId)}">영상 다운로드</button><button class="btn ghost" data-open>폴더 열기</button></div></div>`);
    void okLen;
  } else if (e.cost_usd) {
    addEl(`<div class="muted">이번 지시 $${e.cost_usd.toFixed(4)} · ${e.seconds}초</div>`);
  }
}

function renderPlan() {
  const p = S.plan;
  if (!p) { $("#plan").innerHTML = ""; return; }
  $("#plan").innerHTML = p.steps.map((s, i) => `<span class="s ${i < p.done ? "done" : i === p.done && S.running ? "now" : ""}"><span class="b">${i < p.done ? icon("check", 12) : ""}</span>${esc(s)}</span>`).join("");
}
function renderFoot() {
  const rl = S.st?.relay;
  $("#foot").innerHTML = S.jobId ? `<span>Enter 보내기 · Shift+Enter 줄바꿈 · 파일은 이 칸에 끌어다 놓기</span><span style="margin-left:auto">이번 지시 <b class="mono" style="color:var(--sub)">$${S.runCost.toFixed(4)}</b>${rl && !rl.error && !rl.cohort ? ` · 남은 한도 ${rl.remaining_usd.toFixed(2)}` : ""}</span>` : "";
}
function renderSend() {
  const b = $("#send");
  b.classList.toggle("stop", S.running);
  b.textContent = S.running ? "■" : "↑";
  b.title = S.running ? "멈추기" : "보내기 (Enter)";
  b.disabled = false;
  $("#input").disabled = false;
}

// ---------- 오른쪽 ----------
function setTab(t) { S.tab = t; document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x.dataset.tab === t)); renderRight(); }

function lastArgs(name) {
  const evs = S.job?.events ?? [];
  for (let i = evs.length - 1; i >= 0; i--) if (evs[i].type === "tool_call" && evs[i].name === name) return evs[i].args;
  return null;
}

function renderRight() {
  const rb = $("#rbody");
  if (!S.job) { renderStart(rb); return; }
  const files = S.job.files ?? [];
  const pick = S.previewFile && files.find((f) => f.file === S.previewFile);
  const target = pick ?? files.find((f) => f.file === S.job.output) ?? files.find((f) => f.kind === "html") ?? files.find((f) => f.kind === "video");
  if (S.tab === "preview" && target && target.kind !== "video") {
    const url = fileUrl(target.file) + `?t=${Date.now()}`;
    const bar = `<div class="pvbar"><span class="mono">${esc(target.file)}</span><span class="sp"></span>${target.kind === "html" ? `<button class="btn ghost" id="pvReload">↻ 새로 고침</button><a class="btn ghost" href="${fileUrl(target.file)}" target="_blank">↗ 새 창</a>` : ""}</div>`;
    if (target.kind === "html") rb.innerHTML = `${bar}<iframe class="pvframe" src="${url}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"></iframe>`;
    else if (target.kind === "image") rb.innerHTML = `${bar}<button type="button" class="btn" data-download-image="${esc(target.file)}" data-download-job="${esc(S.jobId)}">${icon("down", 14)} 이미지 다운로드</button><img class="pvimg" src="${url}" data-zoom="${url}" alt="">`;
    else if (target.kind === "audio") rb.innerHTML = `${bar}<audio src="${url}" controls style="width:100%"></audio>`;
    else { rb.innerHTML = `${bar}<pre class="pvcode">불러오는 중…</pre>`; fetch(url).then((r) => r.text()).then((t) => { const p = $(".pvcode"); if (p) p.textContent = t.slice(0, 60000); }); }
    $("#pvReload")?.addEventListener("click", () => renderRight());
    return;
  }
  if (S.tab === "preview") {
    const out = target?.file;
    const concat = lastArgs("concat"); const music = lastArgs("add_music");
    // 중간 파일(tmp/) 길이는 파일 목록에 없으니 도구 결과에서 찾는다
    const durs = new Map(files.map((x) => [x.file, x.duration]));
    for (const ev of S.job.events ?? []) if (ev.type === "tool_result" && ev.result?.file && ev.result.duration != null) durs.set(ev.result.file, ev.result.duration);
    const segs = (concat?.inputs ?? []).map((f) => ({ f, d: durs.get(f) ?? 1 }));
    const total = segs.reduce((a, s) => a + s.d, 0) || 1;
    const v = S.verify && S.verify.file === out ? S.verify : null;
    rb.innerHTML = `
      <div class="player">${out ? `<video id="pv" src="${fileUrl(out)}" preload="metadata"></video><span class="tc" id="tc">00:00.00</span><span class="badge">${out.startsWith("out/") ? "결과" : "원본"} · ${esc(out.split("/").pop())}</span>` : `<div class="empty-p">아직 볼 파일이 없어요</div>`}</div>
      ${out ? `<div class="ctrl"><button class="play" id="pp" aria-label="재생">${icon("play", 14)}</button><span id="tt">0.00 / 0.00</span><span class="sp"></span><button type="button" data-download-video="${esc(out)}" data-download-job="${esc(S.jobId)}">영상 다운로드</button><button id="full">⤢ 크게</button></div>` : ""}
      ${segs.length ? `<div class="tl"><div class="ruler">${[0, .2, .4, .6, .8, 1].map((k) => `<span>${(total * k).toFixed(0)}</span>`).join("")}</div>
        <div class="lane"><span class="lb">V1</span><div class="trk">${segs.map((s) => `<div class="clip" style="flex:${s.d};background-image:url('${thumbUrl(s.f)}')"><span>${esc(s.f.split("/").pop().replace(/\.\w+$/, "").slice(0, 10))}</span></div>`).join("")}</div></div>
        ${music ? `<div class="lane"><span class="lb">A1</span><div class="trk"><div class="aud"><svg id="wave" viewBox="0 0 400 40" preserveAspectRatio="none"></svg></div></div></div>` : ""}
        <div class="playhead" id="ph"></div></div>` : ""}
      ${v ? `<div class="sec-t">측정값 <span class="r">프로그램이 직접 잼</span></div><div class="mtable">
        <span class="k">길이</span><span class="v">${Number(v.duration).toFixed(3)} s</span><span class="ok">${icon("check", 12)}</span>
        <span class="k">해상도 · fps</span><span class="v">${v.width}×${v.height} · ${v.fps}</span><span class="ok">${icon("check", 12)}</span>
        <span class="k">통합 음량</span><span class="v">${v.loudness?.integrated_lufs ?? "—"} LUFS</span><span class="ok">${v.loudness && Math.abs(v.loudness.integrated_lufs + 14) <= 1 ? icon("check", 12) : ""}</span>
        <span class="k">트루피크</span><span class="v">${v.loudness?.true_peak_db ?? "—"} dBTP</span><span class="ok">${v.loudness && v.loudness.true_peak_db <= -1 ? icon("check", 12) : ""}</span></div>` : ""}`;
    if (music) drawWave();
    const pv = $("#pv");
    if (pv) {
      const tick = () => {
        const t = pv.currentTime, d = pv.duration || 0;
        $("#tc").textContent = `00:${String(Math.floor(t)).padStart(2, "0")}.${String(Math.floor((t % 1) * 100)).padStart(2, "0")}`;
        $("#tt").textContent = `${t.toFixed(2)} / ${d.toFixed(2)}`;
        $("#ph")?.style.setProperty("--ph", d ? t / d : 0);
        $("#pp").innerHTML = icon(pv.paused ? "play" : "pause", 14);
      };
      ["timeupdate", "play", "pause", "loadedmetadata"].forEach((k) => pv.addEventListener(k, tick));
      $("#pp").onclick = () => (pv.paused ? pv.play() : pv.pause());
      pv.onclick = () => (pv.paused ? pv.play() : pv.pause());
      $("#full").onclick = () => pv.requestFullscreen?.();
      rb.querySelectorAll(".clip").forEach((c, i) => c.onclick = () => { pv.currentTime = segs.slice(0, i).reduce((a, s) => a + s.d, 0) + 0.01; });
    }
  } else if (S.tab === "term") {
    rb.innerHTML = S.term.length ? S.term.map((t) => `<div class="termcard"><div class="th"><span class="mono">$ ${esc(t.command)}</span><span class="${t.exit_code === 0 ? "ok" : ""}" style="${t.exit_code === 0 ? "" : "color:var(--amber)"}">${t.killed ? esc(t.killed) : `코드 ${t.exit_code}`}</span></div>${t.output?.trim() ? `<pre>${esc(t.output.trim())}</pre>` : ""}</div>`).join("")
      : `<div class="muted">에이전트가 실행한 명령과 결과가 여기에 쌓입니다.</div>`;
    rb.scrollTop = rb.scrollHeight;
  } else if (S.tab === "review") {
    const sh = S.sheet;
    rb.innerHTML = sh ? `<div class="sec-t">8fps 검수 <span class="r">${esc(sh.file)}</span></div>
      <div class="big-sheet">${sh.frames.map((f) => `<figure><img src="${fileUrl(f.file)}" data-zoom="${fileUrl(f.file)}" alt=""><figcaption>${f.t.toFixed(3)}s</figcaption></figure>`).join("")}</div>
      <div class="muted">사진을 누르면 크게 봅니다. 착지·전환 순간이 이상하면 "다시 뽑아 줘" 또는 "1.5초 앞에서 잘라 줘"라고 말하세요.</div>`
      : `<div class="muted">생성한 컷의 움직임을 1초 8장으로 쪼개 보여 줍니다. "C05를 1초부터 검수해 줘"라고 말해 보세요.</div>`;
  } else {
    const ficon = (f) => icon(f.kind === "audio" ? "music" : f.kind === "html" ? "eye" : "file", 18);
    const sz = (n) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`);
    rb.innerHTML = `<div class="drop" id="drop">여기에 파일을 끌어다 놓거나 눌러서 고르세요</div>
      <div class="files">${files.map((f) => `<div class="frow" data-f="${esc(f.file)}" data-k="${f.kind}">
        ${["video", "image"].includes(f.kind) && !f.file.endsWith(".svg") ? `<img src="${thumbUrl(f.file)}" alt="">` : `<div class="ic2">${ficon(f)}</div>`}
        <div><div class="nm">${esc(f.file)}</div><div class="m">${f.kind === "video" || f.kind === "audio" ? `${Number(f.duration ?? 0).toFixed(2)}s · ` : ""}${sz(f.size)}</div></div>
        <span class="fr-r"><span class="muted">${f.file.startsWith("out/") ? "결과" : ""}</span><button class="btn ghost fdel" data-del title="지우기" aria-label="${esc(f.file)} 지우기">${icon("trash")}</button></span></div>`).join("")}</div>
      <button class="btn ghost" data-open>프로젝트 내려받기(zip)</button>`;
    $("#drop").onclick = () => $("#filePick").click();
    bindDrop($("#drop"));
    rb.querySelectorAll(".frow").forEach((r) => r.onclick = async (e) => {
      if (!e.target.closest("[data-del]")) { S.previewFile = r.dataset.f; setTab("preview"); return; }
      if (!confirm(`'${r.dataset.f}'을 지울까요? ${S.job.local ? "내 PC 폴더에서도 지워지고, " : ""}되돌릴 수 없습니다.`)) return;
      try { await api("DELETE", `/api/jobs/${encodeURIComponent(S.jobId)}/files?path=${encodeURIComponent(r.dataset.f)}`); if (S.previewFile === r.dataset.f) S.previewFile = null; await refreshJob(); toast("지웠어요."); }
      catch (err) { toast(err.message, 5000); }
    });
  }
}

function drawWave() {
  const w = $("#wave"); if (!w) return;
  let d = "", s = 7;
  for (let i = 0; i < 200; i++) {
    s = (s * 9301 + 49297) % 233280; const r = s / 233280;
    const fade = i > 183 ? (200 - i) / 17 : 1, h = (6 + r * 13) * fade;
    d += `M${i * 2} ${20 - h}V${20 + h}`;
  }
  w.innerHTML = `<path d="${d}" stroke="#9b8cff" stroke-width="1.2" opacity=".85"/>`;
}

async function prepareFileDownload(button) {
  const { downloadJob, downloadVideo, downloadImage } = button.dataset;
  const label = downloadImage ? "이미지" : "영상";
  button.disabled = true;
  try {
    const file = await fileBlob(downloadJob, downloadImage ?? downloadVideo);
    const url = URL.createObjectURL(file);
    const dialog = document.createElement("dialog");
    dialog.className = "video-save";
    dialog.setAttribute("aria-label", `${label} 다운로드`);
    dialog.innerHTML = `<h2>${label} 다운로드</h2><p class="download-name"></p><p>아래 버튼을 눌러 기기에 저장하세요.</p><div class="acts"><a class="btn pri">${label} 파일 저장</a><button type="button" class="btn ghost">닫기</button></div>`;
    $(".download-name", dialog).textContent = file.name;
    const link = $("a", dialog);
    link.href = url;
    link.download = file.name;
    $("button", dialog).onclick = () => dialog.close();
    dialog.onclose = () => {
      dialog.remove();
      button.focus();
      // 모바일 다운로드 관리자가 원본을 읽을 시간을 준다.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    document.body.append(dialog);
    dialog.showModal();
    link.focus();
  } catch (error) {
    toast(error.code === "NEED_PERMISSION" ? error.message : `${label} 원본을 읽지 못했어요. 프로젝트의 파일 목록을 확인해 주세요.`, 5000);
  } finally {
    button.disabled = false;
  }
}

function lightbox(img, video) {
  const m = document.createElement("div"); m.className = "lightbox";
  m.innerHTML = img ? `<img src="${img}">` : `<video src="${video}" controls autoplay></video>`;
  m.onclick = (e) => { if (e.target === m || img) m.remove(); };
  document.body.append(m);
}

// ---------- 파일 올리기 ----------
async function uploadFiles(list) {
  if (!S.jobId) return toast("먼저 작업을 만들어 주세요.");
  for (const f of list) {
    toast(`올리는 중: ${f.name}`);
    const r = await fetch(`/api/jobs/${encodeURIComponent(S.jobId)}/upload?name=${encodeURIComponent(f.name)}`, { method: "PUT", body: f });
    if (!r.ok) toast(`실패: ${f.name}`);
  }
  toast(`${list.length}개 넣었어요.`);
  await refreshJob();
}
function bindDrop(el) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag"); });
  el.addEventListener("dragleave", () => el.classList.remove("drag"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("drag"); uploadFiles([...e.dataTransfer.files]); });
}

// ---------- 커넥터(MCP) ----------
// 클로드의 "커스텀 커넥터 추가"와 같은 흐름: 추가 → 연결(로그인·허용) → 도구 목록 → 조회 도구 실행
const CX = { el: null, view: "list", list: [], safe: [], tools: null, toolsOf: null, q: "" };

async function openConnectors() {
  if (!CX.el) {
    CX.el = document.createElement("div");
    CX.el.className = "modal";
    CX.el.onclick = (e) => { if (e.target === CX.el) closeConnectors(); };
    document.body.append(CX.el);
  }
  CX.view = "list";
  await loadConnectors();
}
function closeConnectors() { CX.el?.remove(); CX.el = null; refreshState(); }
async function loadConnectors() {
  const j = await api("GET", "/api/connectors");
  CX.list = j.connectors; CX.safe = j.safe_tools;
  renderConnectors();
}

function cxHead(title, sub, back) {
  return `<div class="cx-h">${back ? `<button class="btn ghost" id="cxBack">← 목록</button>` : ""}<div><h3>${title}</h3><p>${sub}</p></div><button class="x" id="cxClose" aria-label="닫기">${icon("x")}</button></div>`;
}

function renderConnectors() {
  if (!CX.el) return;
  if (CX.view === "tools") renderCxTools(); else renderCxList();
  $("#cxClose").onclick = closeConnectors;
  $("#cxBack")?.addEventListener("click", () => { CX.view = "list"; loadConnectors(); });
}

function renderCxTools() {
  const c = CX.list.find((x) => x.id === CX.toolsOf);
  const q = CX.q.toLowerCase();
  const list = (CX.tools ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q));
  CX.el.innerHTML = `<div class="cx">${cxHead(`${esc(c.name)}의 도구 ${CX.tools ? CX.tools.length + "개" : ""}`,
    `MCP 서버가 알려 준 도구 목록입니다. 에이전트는 이 중에서 필요한 도구를 골라 부릅니다. <b style="color:var(--mint)">눌러 보기</b> 표시가 있는 조회 도구는 여기서 직접 실행해 볼 수 있어요(크레딧 0).`, true)}
    <div class="cx-b"><input class="tsearch" id="tq" placeholder="도구 이름이나 설명으로 찾기 (예: video, balance)" value="${esc(CX.q)}">
    <div id="tlist" style="display:grid;gap:8px"></div></div></div>`;
  const tl = $("#tlist");
  const draw = () => {
    const qq = CX.q.toLowerCase();
    const l = (CX.tools ?? []).filter((t) => !qq || t.name.toLowerCase().includes(qq) || (t.description ?? "").toLowerCase().includes(qq));
    // 눌러 볼 수 있는 도구를 위로
    l.sort((a, b) => (CX.safe.includes(b.name) ? 1 : 0) - (CX.safe.includes(a.name) ? 1 : 0));
    tl.innerHTML = !CX.tools ? `<div class="thinking"><i></i><i></i><i></i> 도구 목록을 받는 중</div>`
      : l.map((t) => `<div class="trow" data-t="${esc(t.name)}"><div class="tn">${esc(t.name)}${CX.safe.includes(t.name) ? `<span class="safe">눌러 보기</span>` : ""}</div><div class="td">${esc(t.description)}</div></div>`).join("") || `<div class="muted">찾는 도구가 없어요.</div>`;
    tl.querySelectorAll(".trow").forEach(bindToolRow);
  };
  void list;
  $("#tq").oninput = (e) => { CX.q = e.target.value; draw(); };
  draw();
}

function bindToolRow(r) {
  r.onclick = (e) => {
    if (e.target.closest("button, pre")) return;
    const t = CX.tools.find((x) => x.name === r.dataset.t);
    if (r.classList.toggle("open")) {
      r.insertAdjacentHTML("beforeend", `<pre>${esc(JSON.stringify(t.inputSchema?.properties ?? {}, null, 2).slice(0, 4000))}</pre>${CX.safe.includes(t.name) ? `<div class="run" style="margin-top:8px"><button class="btn pri">▶ 실행해 보기</button></div>` : ""}`);
      const b = $(".run .pri", r);
      if (b) b.onclick = async () => {
        b.disabled = true; b.textContent = "실행 중…";
        try {
          const args = t.name === "models_explore" ? { action: "search", query: "kling", type: "video", limit: 5 } : {};
          const j = await api("POST", `/api/connectors/${CX.toolsOf}/call`, { name: t.name, args });
          r.insertAdjacentHTML("beforeend", `<pre style="border-color:rgba(70,224,181,.35)">→ ${esc(t.name)}(${esc(JSON.stringify(args))})\n← ${j.ms}ms\n${esc(JSON.stringify(j.result, null, 2).slice(0, 3000))}</pre>`);
        } catch (err) { r.insertAdjacentHTML("beforeend", `<pre style="color:#ffb3b3">${esc(err.message)}</pre>`); }
        b.parentElement.remove();
      };
    } else { r.querySelectorAll("pre, .run").forEach((x) => x.remove()); }
  };
}

const HF_URL = "https://mcp.higgsfield.ai/mcp";
function renderCxList() {
  // 추천 커넥터: 진짜 힉스필드가 아직 연결되지 않았으면 맨 위에 한 번 누르기 카드
  const hf = CX.list.find((c) => !c.practice && c.url === HF_URL);
  const feat = hf?.connected ? "" : `<div class="feat"><div class="av hf">H</div>
      <div><div class="k">추천 커넥터</div><div class="nm">Higgsfield</div><div class="u">영상·이미지 생성 도구 185개 · 내 힉스필드 계정 크레딧으로 만들어요</div></div>
      <button class="btn pri" id="cxFeat">${hf?.logging_in ? "다시 로그인" : "한 번에 연결"}</button></div>`;
  CX.el.innerHTML = `<div class="cx">${cxHead("커넥터", "무덱스가 바깥 서비스의 도구를 쓰게 연결합니다. 클로드의 '커넥터 추가'와 같은 방식(원격 MCP)입니다.")}
    <div class="cx-b">${feat}
    ${CX.list.map((c) => `<div class="cc"><div class="av ${c.connected ? "on" : ""}">${esc(c.name[0] ?? "?")}</div>
      <div><div class="nm">${esc(c.name)} ${c.practice ? `<span class="pill amber">연습 모드</span>` : ""} ${c.connected ? `<span class="pill mint">● 연결됨${c.tools_count ? ` · 도구 ${c.tools_count}` : ""}</span>` : c.logging_in ? `<span class="pill violet">로그인 기다리는 중…</span>` : `<span class="pill">연결 안 됨</span>`}</div><div class="u">${esc(c.url)}</div></div>
      <div class="acts" data-id="${c.id}">${c.connected ? `<button class="btn" data-a="tools">도구 보기</button><button class="btn ghost" data-a="disconnect">연결 끊기</button>` : `<button class="btn vio" data-a="connect">연결</button>`}<button class="btn ghost" data-a="remove" title="목록에서 빼기" aria-label="목록에서 빼기">${icon("trash")}</button></div></div>`).join("")}
    <div class="addf"><b>＋ 커스텀 커넥터 추가</b>
      <label>이름<input type="text" id="cxName" placeholder="예) Higgsfield"></label>
      <label>원격 MCP 서버 주소<input type="text" id="cxUrl" placeholder="https://…/mcp"></label>
      <label class="chk"><input type="checkbox" id="cxPractice"> 연습 모드: 계정 없이 같은 흐름을 해 봅니다(실제로는 연결하지 않음)</label>
      <div class="row"><button class="btn pri" id="cxAdd">추가</button><button class="btn ghost" id="cxFill">힉스필드 주소 넣기</button><span class="msg" id="cxMsg"></span></div>
    </div>
    <div class="howto"><b>순서</b> ① 이름과 MCP 서버 주소를 넣고 추가 → ② <b>연결</b>을 누르면 브라우저에 로그인 창이 뜹니다 → ③ 로그인하고 <b>허용</b> → ④ 무덱스로 돌아오면 <b>연결됨</b>, 도구 목록이 보입니다 → ⑤ <b>balance</b> 같은 조회 도구를 눌러 첫 호출을 해 봅니다.<br>
    힉스필드 주소: <span class="mono">https://mcp.higgsfield.ai/mcp</span> · 로그인은 OAuth라 무덱스는 비밀번호를 보지 않고, 받은 토큰은 이 브라우저에만 저장됩니다(공용 PC면 다 쓴 뒤 연결 끊기).</div>
    </div></div>`;
  $("#cxFeat")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    window.__mudexPopup = window.open("/oauth/callback.html?pending=1", "mudex-oauth", "width=520,height=720");
    btn.disabled = true; btn.textContent = "창 여는 중…";
    try {
      const id = hf?.id ?? (await api("POST", "/api/connectors", { name: "Higgsfield", url: HF_URL, practice: false })).id;
      const r = await api("POST", `/api/connectors/${id}/connect`);
      if (r.blocked) toast("팝업이 막혔어요. 주소창 오른쪽의 팝업 허용을 눌러 주세요.", 7000); else toast("새 창에서 힉스필드에 로그인하고 '허용'을 눌러 주세요.", 5000);
    } catch (err) { window.__mudexPopup?.close(); toast(err.message, 5000); }
    await loadConnectors();
  });
  $("#cxFill").onclick = () => { $("#cxName").value = "Higgsfield"; $("#cxUrl").value = "https://mcp.higgsfield.ai/mcp"; };
  $("#cxAdd").onclick = async () => {
    try { await api("POST", "/api/connectors", { name: $("#cxName").value, url: $("#cxUrl").value, practice: $("#cxPractice").checked }); await loadConnectors(); }
    catch (e) { $("#cxMsg").textContent = e.message; }
  };
  CX.el.querySelectorAll(".acts button").forEach((b) => b.onclick = async () => {
    const id = b.parentElement.dataset.id, a = b.dataset.a;
    try {
      if (a === "connect") {
        // 팝업 차단을 피하려고 누른 순간 창을 먼저 연다(주소는 준비되면 바꾼다)
        window.__mudexPopup = window.open("/oauth/callback.html?pending=1", "mudex-oauth", "width=520,height=720");
        b.disabled = true; b.textContent = "창 여는 중…";
        const r = await api("POST", `/api/connectors/${id}/connect`);
        if (r.blocked) toast("팝업이 막혔어요. 주소창 오른쪽의 팝업 허용을 눌러 주세요.", 7000); else toast("새 창에서 로그인하고 '허용'을 눌러 주세요.", 5000);
        await loadConnectors();
      }
      if (a === "disconnect") { await api("POST", `/api/connectors/${id}/disconnect`); await loadConnectors(); }
      if (a === "remove") { if (confirm("이 커넥터를 목록에서 뺄까요? 연결도 끊깁니다.")) { await api("POST", `/api/connectors/${id}/remove`); await loadConnectors(); } }
      if (a === "tools") {
        CX.view = "tools"; CX.toolsOf = id; CX.tools = null; CX.q = ""; renderConnectors();
        CX.tools = (await api("GET", `/api/connectors/${id}/tools`)).tools; renderConnectors();
      }
    } catch (e) { toast(e.message, 5000); await loadConnectors(); }
  });
}

// ---------- 흐름 ----------
async function refreshState() {
  if (!S.st) {
    try { S.st = await api("GET", "/api/state?local"); applyState(); } catch {}
  }
  try { S.st = await api("GET", "/api/state"); } catch { S.st = null; }
  applyState();
}
function applyState() {
  if (S.st) { $("#model").value = `${S.st.model}|${S.st.effort}`; $("#approval").value = S.st.approval; renderThemeBtn(); }
  renderSide(); renderFoot();
  if (!S.jobId) { renderEmpty(); renderRight(); }
}

async function refreshJob() {
  if (!S.jobId) return;
  const j = await api("GET", `/api/jobs/${encodeURIComponent(S.jobId)}`);
  S.job = { ...S.job, ...j };
  renderTop(); renderRight();
}

async function openJob(id) {
  const seq = (S.openSeq = (S.openSeq ?? 0) + 1); // 열기가 겹치면 마지막 것만 살린다(소식을 두 번 받아 같은 말이 여러 번 그려지는 것 방지)
  S.jobId = id; localStorage.setItem("mudex.job", id);
  S.es?.close();
  S.cards.clear(); S.gens.clear(); S.plan = null; S.sheet = null; S.verify = null; S.runCost = 0; S.lastTrimCard = null; S.term = []; S.previewFile = null;
  let j;
  try { j = await api("GET", `/api/jobs/${encodeURIComponent(id)}`); if (seq !== S.openSeq) return; }
  catch (e) {
    if (seq !== S.openSeq) return;
    if (/다시 허용/.test(e.message)) return renderNeedPermission(id);
    S.jobId = null; localStorage.removeItem("mudex.job"); renderEmpty(); return;
  }
  S.job = j; S.running = j.running;
  $("#feed").innerHTML = `<div class="col"></div>`;
  if (!j.events.length) addEl(`<div class="say hint">새 프로젝트입니다. 하고 싶은 걸 말해 주세요. 필요한 파일은 아래 입력창에 끌어다 놓으면 됩니다.\n예) “우리 반 OX 퀴즈 웹페이지 만들어 줘”\n예) “힉스필드로 수달이 헤엄치는 5초 영상 만들어 줘”\n예) “힉스필드 Kling 2.6 가격을 찾아서 표로 정리해 줘”</div>`);
  for (const e of j.events) renderEvent(e, false);
  // 기록은 '일하는 중'으로 끝났는데 실제로는 안 돌고 있으면(새로 고침·창 닫기로 끊김) 그렇다고 알린다
  if (S.running && !j.running) addEl(`<div class="say muted">이 작업은 새로 고침(또는 창 닫기)으로 중간에 멈췄어요. 만든 파일은 그대로 있어요. 이어서 하려면 아래에 적어 주세요. 예) "1번 사진으로 이어서 영상 만들어 줘"</div>`);
  S.running = j.running;
  if (S.running) showBusy(); else closeAsks();
  renderPlan(); renderTop(); renderSend(); renderFoot(); renderSide(); renderRight();
  scrollFeed();
  S.es?.close();
  S.es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  S.es.onmessage = (m) => { const e = JSON.parse(m.data); S.job.events.push(e); renderEvent(e, true); };
}

// 한글 입력기에서 Enter가 두 번 들어와도 한 번만 보낸다
async function send(fromKey) {
  if (S.sending) return;
  S.sending = true;
  try { await sendOnce(fromKey); } finally { S.sending = false; }
}
async function sendOnce(fromKey) {
  if (S.running) {
    // Enter는 작업을 멈추지 않는다(다음 말을 적다가 실수로 멈추지 않게). 멈춤은 ■ 단추로만
    if (fromKey === true) return toast("작업 중이에요. 끝난 뒤에 보내거나, 멈추려면 오른쪽 ■ 단추를 누르세요.", 3500);
    await api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/stop`).catch(() => {}); return;
  }
  const t = $("#input").value.trim();
  if (!t) return;
  if (!S.st?.code_set) return showEntry();
  // 프로젝트 없이 보내면 첫마디로 이름을 지어 새로 만든다
  if (!S.jobId) {
    const flat = t.replace(/\s+/g, " ");
    const name = flat.length <= 22 ? flat : flat.slice(0, 22).replace(/\s\S*$/, "") || flat.slice(0, 22);
    const { id } = await api("POST", "/api/jobs", { name });
    await refreshState(); await openJob(id);
  }
  $("#input").value = ""; autosize();
  try { await api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/run`, { text: t }); }
  catch (e) { toast(e.message); $("#input").value = t; }
}
function autosize() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(180, t.scrollHeight) + "px"; }


function renderThemeBtn() {
  const t = document.documentElement.dataset.theme;
  document.querySelectorAll("#themeBtn [data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
}

// PC 폴더는 브라우저를 다시 열면 한 번 더 허용을 받아야 한다(보안 규칙)
function renderNeedPermission(id) {
  S.job = null; renderTop();
  $("#top").innerHTML = `<h1>${esc(id)}</h1><span class="sp"></span><span class="pill amber">허용 필요</span>`;
  $("#feed").innerHTML = `<div class="col"><div class="welcome"><h2>PC 폴더를 다시 허용해 주세요</h2>
    <p>'${esc(id)}' 프로젝트는 내 PC 폴더를 씁니다. 브라우저를 다시 열면 보안을 위해 한 번 더 허용해야 합니다.</p>
    <div class="welcome-foot"><button class="btn pri" id="grantBtn">${icon("folder", 14)} 폴더 허용</button></div></div></div>`;
  $("#grantBtn").onclick = async () => { try { await grantFolder(id); await openJob(id); } catch (e) { toast(e.message); } };
  renderSide(); renderRight();
}
async function openFolder() {
  try { const id = await openLocalFolder(); await refreshState(); await openJob(id); toast("PC 폴더를 프로젝트로 열었어요. 만든 파일이 이 폴더에 바로 생깁니다.", 4500); }
  catch (e) { if (e.name !== "AbortError") toast(e.message); }
}

// 입장 화면: 연수 코드 + 이름. QR 주소(?j=연수코드)로 오면 연수 코드가 미리 채워진다.
function showEntry(message) {
  if ($("#entry")) return;
  const q = new URLSearchParams(location.search);
  const pre = (q.get("j") ?? "").toUpperCase();
  const el = document.createElement("div");
  el.id = "entry";
  el.innerHTML = `<div class="entry-card" role="dialog" aria-modal="true" aria-labelledby="entryT">
    <div class="entry-mark"><svg width="44" height="44" viewBox="0 0 30 30"><rect width="30" height="30" rx="8" fill="#146b7c"/><rect x="3.5" y="5" width="2" height="3" rx=".6" fill="#ffffff" opacity=".55"/><rect x="3.5" y="13.5" width="2" height="3" rx=".6" fill="#ffffff" opacity=".55"/><rect x="3.5" y="22" width="2" height="3" rx=".6" fill="#ffffff" opacity=".55"/><path d="M9.5 21.5V9l6 6.5 6-6.5v12.5" stroke="#ffffff" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1 id="entryT">무덱스</h1>
    <p class="entry-sub">말로 시키면 만드는 나만의 코딩 에이전트</p>
    ${message ? `<p class="entry-note">${esc(message)}</p>` : ""}
    <form id="entryForm" autocomplete="off">
      <label>연수 코드<input id="eCode" inputmode="latin" maxlength="8" value="${esc(pre)}" placeholder="화면의 6자리" autocapitalize="characters" spellcheck="false"></label>
      <label>이름<input id="eName" maxlength="20" value="${esc(S.st?.name ?? "")}" placeholder="예) 김민지"></label>
      <div class="entry-msg" id="eMsg" role="alert"></div>
      <button class="btn pri entry-go" type="submit">들어가기</button>
    </form>
    <a class="entry-teacher" href="/admin">강사</a>
  </div>`;
  document.body.append(el);
  const code = $("#eCode"), name = $("#eName");
  (pre ? name : code).focus();
  code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^0-9A-Z]/g, ""); });
  $("#entryForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#eMsg").textContent = "";
    if (!code.value.trim()) return ($("#eMsg").textContent = "연수 코드를 넣어 주세요.");
    if (!name.value.trim()) return ($("#eMsg").textContent = "이름을 넣어 주세요.");
    const btn = $(".entry-go"); btn.disabled = true; btn.textContent = "들어가는 중…";
    try {
      const r = await api("POST", "/api/join", { entry_code: code.value, name: name.value });
      history.replaceState(null, "", location.pathname);
      el.remove();
      await refreshState();
      toast(r.again ? `다시 오셨네요, ${name.value.trim()} 선생님.` : `${r.cohort.name}에 들어왔어요.`, 3500);
    } catch (err) { $("#eMsg").textContent = err.message; btn.disabled = false; btn.textContent = "들어가기"; }
  };
}
// 강사 화면에서 '무덱스 열기'로 오면 강사용 코드가 주소에 붙어 온다(?code=…)
async function takeCodeFromUrl() {
  const q = new URLSearchParams(location.search);
  const c = q.get("code");
  if (!c) return false;
  history.replaceState(null, "", location.pathname);
  try { await api("POST", "/api/code", { code: c }); return true; } catch { return false; }
}

// ---------- 묶기 ----------
$("#newJob").onclick = newJob;
if ($("#openFolder")) $("#openFolder").onclick = openFolder;
document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key.toLowerCase() === "o") { e.preventDefault(); openFolder(); } });
$("#themeBtn").onclick = (e) => {
  const want = e.target.closest("[data-t]")?.dataset.t ?? (document.documentElement.dataset.theme === "b" ? "a" : "b");
  document.documentElement.dataset.theme = want;
  renderThemeBtn();
  api("POST", "/api/settings", { theme: want });
};
$("#openCx").onclick = () => openConnectors();
$("#send").onclick = () => send();
$("#input").addEventListener("input", autosize);
$("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(true); } });
$("#addFile").onclick = () => $("#filePick").click();
$("#filePick").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };
$("#approval").onchange = (e) => api("POST", "/api/settings", { approval: e.target.value }).then(() => toast(e.target.value === "auto" ? "자동 실행: 크레딧 드는 일만 묻습니다." : "물어보고 하기: 명령·바깥 서비스 실행 전에 묻습니다."));
$("#model").onchange = (e) => { const [model, effort] = e.target.value.split("|"); api("POST", "/api/model", { model, effort }); };
bindDrop($("#composer"));
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));

// 웹판은 이 창이 곧 작업 엔진이라, 작업 중에 새로 고치거나 닫으면 작업이 끊긴다. 브라우저 확인 창으로 한 번 묻는다
window.addEventListener("beforeunload", (e) => { if (S.running) { e.preventDefault(); e.returnValue = ""; } });

// 그림이 서비스 워커로 안 열리면(내 PC 폴더 등) 화면이 파일을 직접 읽어 다시 붙인다
document.addEventListener("error", async (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || el.dataset.fb) return;
  const m = new URL(el.src, location.href).pathname.match(/^\/(f|thumb)\/([^/]+)\/(.+)$/);
  if (!m || (m[1] === "thumb" && !/\.(png|jpe?g|webp|gif|svg)$/i.test(m[3]))) return;
  el.dataset.fb = "1";
  try { el.src = URL.createObjectURL(await fileBlob(decodeURIComponent(m[2]), m[3].split("/").map(decodeURIComponent).join("/"))); } catch {}
}, true);

// 가운데 경계를 끌어 대화·미리보기 넓이를 바꾼다(브라우저에 기억, 두 번 누르면 처음대로)
const RW_KEY = "mudex.rightWidth";
const setRW = (px) => {
  if (px == null) { document.documentElement.style.removeProperty("--rw"); return; }
  const max = Math.max(320, window.innerWidth - 236 - 520); // 대화 칸은 최소 500px 남긴다
  document.documentElement.style.setProperty("--rw", `${Math.round(Math.min(max, Math.max(300, px)))}px`);
};
try { const w = Number(localStorage.getItem(RW_KEY)); if (w) setRW(w); } catch {}
window.addEventListener("resize", () => { const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rw")); if (v) setRW(v); });
const split = $("#split");
split.addEventListener("pointerdown", (e) => {
  e.preventDefault(); split.setPointerCapture(e.pointerId); document.body.classList.add("resizing");
  const move = (ev) => setRW(window.innerWidth - ev.clientX - 8);
  const up = () => {
    split.removeEventListener("pointermove", move); split.removeEventListener("pointerup", up); document.body.classList.remove("resizing");
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rw"));
    try { if (v) localStorage.setItem(RW_KEY, v); } catch {}
  };
  split.addEventListener("pointermove", move); split.addEventListener("pointerup", up);
});
split.addEventListener("dblclick", () => { setRW(null); try { localStorage.removeItem(RW_KEY); } catch {} });
split.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const cur = $(".right").getBoundingClientRect().width;
  setRW(cur + (e.key === "ArrowLeft" ? 40 : -40));
  try { localStorage.setItem(RW_KEY, parseInt(getComputedStyle(document.documentElement).getPropertyValue("--rw"))); } catch {}
});

// 미리보기 크게 보기: 오른쪽 칸이 창 전체를 덮는다. Esc나 같은 단추로 돌아온다
const MAX_ICON = (on) => on
  ? `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10h4v4M14 6h-4V2M6 10l-4.5 4.5M10 6l4.5-4.5"/></svg>`
  : `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5"/></svg>`;
function setMax(on) {
  document.body.classList.toggle("pvmax", on);
  $("#maxBtn").innerHTML = MAX_ICON(on);
  $("#maxBtn").title = on ? "작게 보기 (Esc)" : "크게 보기 (Esc로 돌아오기)";
  $("#maxBtn").setAttribute("aria-label", on ? "미리보기 작게 보기" : "미리보기 크게 보기");
}
setMax(false);
$("#maxBtn").onclick = () => setMax(!document.body.classList.contains("pvmax"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("pvmax") && !document.querySelector(".modal, #entry")) setMax(false); });
document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); newJob(); } });
document.addEventListener("click", (e) => {
  const download = e.target.closest("[data-download-video], [data-download-image]");
  if (download) { e.preventDefault(); prepareFileDownload(download); return; }
  const z = e.target.closest("[data-zoom]"); if (z) return lightbox(z.dataset.zoom);
  const pc = e.target.closest("[data-preview]"); if (pc) { S.previewFile = pc.dataset.preview; setTab("preview"); return; }
  const p = e.target.closest("[data-play]"); if (p) { e.preventDefault(); setTab("preview"); setTimeout(() => $("#pv")?.play(), 100); return; }
  if (e.target.closest("[data-open]")) api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/open`);
});
const ges = new EventSource("/api/events");
ges.onmessage = (m) => {
  const e = JSON.parse(m.data);
  if (e.type === "hf_changed") { refreshState(); toast(e.error ? `힉스필드 로그인 실패: ${e.error}` : "힉스필드 로그인 완료!"); }
  if (e.type === "connectors_changed") {
    refreshState();
    if (CX.el && CX.view === "list") loadConnectors();
    if (e.ok === true) toast("연결됐어요! '도구 보기'를 눌러 보세요.", 4000);
    if (e.ok === false) toast(`연결하지 못했어요: ${e.error}`, 6000);
  }
  if (e.type === "jobs_changed") { refreshState(); if (S.jobId) refreshJob(); }
};

// 작업 화면은 상태 조회(중계 서버·힉스필드)를 기다리지 않고 먼저 띄운다
await takeCodeFromUrl();
renderSend();
const stReady = refreshState().then(() => {
  const rl = S.st?.relay;
  if (!S.st?.code_set || new URLSearchParams(location.search).has("j")) showEntry();
  else if (rl?.error && /폐기|만료|끝났/.test(rl.error)) { api("POST", "/api/leave"); showEntry("연수가 끝났어요. 새 연수 코드로 들어와 주세요."); }
});
if (S.jobId) await openJob(S.jobId); else { renderEmpty(); renderRight(); }
await stReady;
// 연수 코드가 없으면 입장 화면을 띄운다(위 시작 순서)
