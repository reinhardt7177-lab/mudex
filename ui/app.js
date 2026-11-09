// 무덱스 화면. 서버(app/server.mjs)의 /api와 실시간 이벤트(SSE)로 움직인다.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtS = (s) => (s == null ? "" : `${Number(s).toFixed(s % 1 ? 3 : 0)}s`);
const enc = (rel) => rel.split("/").map(encodeURIComponent).join("/");
const fileUrl = (rel) => `/f/${encodeURIComponent(S.jobId)}/${enc(rel)}`;
const thumbUrl = (rel) => `/thumb/${encodeURIComponent(S.jobId)}/${enc(rel)}`;
const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status===401) { location.href='/'; throw new Error('강사 코드로 다시 입장해 주세요.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `오류 ${r.status}`);
  return j;
};
function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), ms);
}

const S = { st: null, jobId: new URLSearchParams(location.search).get("job") ?? localStorage.getItem("mudex.job"), job: null, es: null, tab: "preview", cards: new Map(), plan: null, runCost: 0, gens: new Map(), sheet: null, verify: null, running: false, lastTrimCard: null };
function closeMobilePanels() {
  $('.app').classList.remove('show-side','show-preview');
  $('#mobileSide')?.setAttribute('aria-expanded','false');$('#mobilePreview')?.setAttribute('aria-expanded','false');
}
for(const [id,cls] of [['mobileSide','show-side'],['mobilePreview','show-preview']]) $('#'+id)?.addEventListener('click',()=>{
  const show=!$('.app').classList.contains(cls);closeMobilePanels();if(show){$('.app').classList.add(cls);$('#'+id).setAttribute('aria-expanded','true');}
});

// ---------- 왼쪽 ----------
function renderSide() {
  const st = S.st;
  const jobs = st?.jobs ?? [];
  const today = new Date().toDateString();
  const groups = { 오늘: [], 이전: [] };
  for (const j of jobs) (new Date(j.updated).toDateString() === today ? groups.오늘 : groups.이전).push(j);
  $("#jobs").innerHTML = Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) => `
    <div><div class="group-t">${k}</div>${v.map((j) => `
      <div class="job ${j.id === S.jobId ? "on" : ""}" data-id="${esc(j.id)}">
        ${j.thumb ? `<img src="/thumb/${encodeURIComponent(j.id)}/${enc(j.thumb)}" alt="">` : `<div class="ph"></div>`}
        <span class="nm">${esc(j.name)}</span>${j.id === S.jobId && S.running ? `<span class="dot"></span>` : ""}
      </div>`).join("")}</div>`).join("") || `<div class="muted" style="padding:0 10px">아직 작업이 없어요.</div>`;
  for (const el of document.querySelectorAll(".job")) el.onclick = () => {closeMobilePanels();openJob(el.dataset.id);};

  const hf = st?.hf ?? {};
  const rl = st?.relay;
  const hfRow = hf.logged_in
    ? `<div class="conn-row"><span class="led ${hf.error ? "warn" : ""}"></span><span>힉스필드</span><span class="v">${hf.credits != null ? `${hf.credits} 크레딧` : "연결됨"}</span>
       <div class="meter"><i style="width:${Math.min(100, ((hf.credits ?? 0) / 200) * 100)}%;background:var(--violet)"></i></div></div>`
    : `<div class="conn-row"><span class="led off"></span><span>힉스필드</span><span class="act" id="hfLogin">${hf.logging_in ? "연결 중…" : "연결하기"}</span></div>`;
  const codeRow = !st?.code_set
    ? `<div class="conn-row"><span class="led off"></span><span>강사 코드</span><span class="act" id="setCode">넣기</span></div>`
    : rl?.error
      ? `<div class="conn-row"><span class="led warn"></span><span>강사 코드</span><span class="act" id="setCode">다시 넣기</span></div><div class="conn-foot"><span style="color:var(--amber)">${esc(rl.error)}</span></div>`
      : `<div class="conn-row"><span class="led"></span><span>강사 코드</span><span class="v">$${(rl?.remaining_usd ?? 0).toFixed(2)} 남음</span>
         <div class="meter"><i style="width:${rl ? (rl.remaining_usd / rl.budget_usd) * 100 : 0}%;background:var(--mint)"></i></div></div>
         <div class="conn-foot"><span class="mono">${esc(st.code_hint)}</span><span>${rl?.expires_at ? new Date(rl.expires_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) + "까지" : ""}</span></div>`;
  $("#conn").innerHTML = hfRow + codeRow + (st?.cloud ? '<button class="chip" id="cloudLogout" style="margin:12px">저장하고 나가기</button>' : '');
  $('#cloudLogout')?.addEventListener('click',async()=>{try {await api('POST','/cloud/logout');localStorage.removeItem('mudex.job');location.href='/';}catch(e){toast(e.message);}});
  $("#hfLogin")?.addEventListener("click", () => openConnectors());
  $("#setCode")?.addEventListener("click", askCode);
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
  m.innerHTML = `<div class="box"><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ""}<input value="${esc(value)}" placeholder="${esc(placeholder ?? "")}"><div class="msg"></div>
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

function askCode() {
  modal({
    title: "강사 코드 넣기", text: "강사님이 나눠 준 코드를 넣어 주세요. 예) MDX-AB12-CD34", placeholder: "MDX-XXXX-XXXX", ok: "연결",
    onOk: async (v) => {
      if(S.st?.cloud){await api('POST','/cloud/login',{code:v});localStorage.removeItem('mudex.job');location.href='/';return;}
      await api("POST", "/api/code", { code: v }); await refreshState(); toast("강사 코드가 연결됐어요.");
    },
  });
}

function newJob() {
  modal({
    title: "새 작업", text: "작업 이름을 정해 주세요. 작업마다 폴더가 하나씩 생깁니다.", placeholder: "예) 우리 학교 소개 30초", ok: "만들기",
    onOk: async (v) => { const { id } = await api("POST", "/api/jobs", { name: v }); await refreshState(); openJob(id); },
  });
}

// ---------- 가운데 ----------
function renderTop() {
  if (!S.job) { $("#top").innerHTML = `<h1>무덱스</h1><span class="sp"></span>`; return; }
  const files = S.job.files ?? [];
  const nv = files.filter((f) => f.kind === "video").length, na = files.filter((f) => f.kind === "audio").length, ni = files.filter((f) => f.kind === "image").length;
  $("#top").innerHTML = `<h1>${esc(S.jobId)}</h1><span class="path">${S.st?.cloud ? '클라우드 작업공간' : esc(S.job.dir)}</span><span class="sp"></span>
    <span class="pill">영상 ${nv} · 음악 ${na} · 사진 ${ni}</span>
    ${S.running ? `<span class="pill violet">● 작업 중</span>` : `<span class="pill mint">● 대기</span>`}`;
}

function renderEmpty() {
  const st = S.st ?? {};
  $("#feed").innerHTML = `<div class="empty"><div>
    <svg width="56" height="56" viewBox="0 0 30 30"><rect width="30" height="30" rx="8" fill="#46e0b5"/><path d="M9.5 21.5V9l6 6.5 6-6.5v12.5" stroke="#04261c" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h2>말로 시키는 영상 편집실</h2><p>클립을 넣고 하고 싶은 걸 말하면, 무덱스가 자르고 붙이고 생성하고 검수합니다.</p>
    <div class="steps">
      <div class="${st.code_set && !st.relay?.error ? "ok" : ""}"><b>1. 강사 코드</b>왼쪽 아래에서 넣기</div>
      <div class="${st.hf?.logged_in ? "ok" : ""}"><b>2. 힉스필드 로그인</b>영상 생성할 때 필요</div>
      <div><b>3. 새 작업</b>클립을 끌어다 놓기</div>
    </div>
    <div class="examples"><button id="exNew">＋ 새 작업 만들기</button></div>
  </div></div>`;
  $("#exNew").onclick = newJob;
}

// 짧은 마크다운만: 굵게, 코드, 링크(작업 폴더 파일이면 재생·보기)
const md = (t) => esc(t)
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => /^https?:/.test(href)
    ? `<a href="${href}" target="_blank" style="color:var(--mint)">${label}</a>`
    : /\.(mp4|mov|webm)$/i.test(href) ? `<a href="#" data-play="${href}" style="color:var(--mint)">▶ ${label}</a>`
    : `<a href="#" data-zoom="${fileUrl(href)}" style="color:var(--mint)">${label}</a>`);

const TOOL_META = {
  list_clips: ["▤", "클립 살펴보기"], probe: ["◎", "길이 재기"], trim: ["✂", "자르기"], concat: ["⧉", "이어 붙이기"],
  add_music: ["♪", "음악 얹기"], export_final: ["⤓", "내보내기"], measure: ["◉", "결과 재기"],
  make_keyframes: ["▣", "키프레임 그리기"], ask_pick: ["☝", "골라 주세요"], generate_video: ["✦", "영상 생성"], review_sheet: ["▦", "8fps 검수 시트"],
};

function toolSummary(name, a = {}) {
  switch (name) {
    case "trim": return `${a.input} · ${Number(a.start).toFixed(2)} → ${Number(a.end).toFixed(2)}`;
    case "concat": return `${(a.inputs ?? []).length}개 → ${a.output}`;
    case "add_music": return `${a.music}${a.fade_out ? ` · 끝 ${a.fade_out}초 페이드` : ""}`;
    case "export_final": return `${a.output}${a.duration ? ` · ${a.duration}초` : ""} · 음량 ${a.target_lufs ?? -14} LUFS`;
    case "measure": case "probe": return a.file;
    case "make_keyframes": return `gpt-image · ${a.count ?? 4}장 · 크레딧 0`;
    case "generate_video": return `${a.model ?? "kling3_0"} · ${a.duration ?? 5}초 · ${a.start_image}`;
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
    case "user": S.runCost = 0; addEl(`<div class="you">${esc(e.text)}</div>`); break;
    case "assistant": addEl(`<div class="say">${md(e.text)}</div>`); break;
    case "plan": S.plan = e; renderPlan(); break;
    case "cost": S.runCost += e.cost_usd ?? 0; if (e.remaining_usd != null && S.st?.relay) S.st.relay.remaining_usd = e.remaining_usd; renderFoot(); break;
    case "tool_call": renderToolCall(e); break;
    case "tool_result": renderToolResult(e); break;
    case "ask": renderAsk(e, live); break;
    case "answer": markAnswered(e); break;
    case "gen": updateGen(e); break;
    case "sheet": S.sheet = e; renderSheet(e); if (live) setTab("review"); break;
    case "done": S.verify = e.verify; renderDone(e); if (live) { refreshJob(); setTab("preview"); } break;
    case "error": addEl(`<div class="errcard">⚠ ${esc(e.message)}</div>`); break;
    case "status": S.running = e.running; renderTop(); renderSend(); renderSide(); break;
  }
  if (S.running && live && !["status"].includes(e.type)) addEl(`<div class="thinking"><i></i><i></i><i></i> 무덱스가 일하는 중</div>`);
  if (live) scrollFeed();
}

function renderToolCall(e) {
  // set_plan은 아래 할 일 목록으로, ask_pick은 고르기 카드로 보여 주므로 따로 카드를 만들지 않는다
  if (e.name === "set_plan" || e.name === "ask_pick") return;
  const [ic, nm] = TOOL_META[e.name] ?? ["•", e.name];
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
  const card = addEl(`<div class="tool"><div class="tool-h"><span class="ic">${ic}</span><span class="nm">${esc(nm)}</span><span class="fn">${esc(toolSummary(e.name, e.args))}</span><span class="st"><span class="spin"></span></span></div></div>`);
  S.cards.set(e.id, { card, args: e.args });
}

function renderToolResult(e) {
  if (e.name === "set_plan" || e.name === "ask_pick") return;
  const ref = S.cards.get(e.id);
  if (!ref) return;
  const { card, row } = ref;
  const r = e.result ?? {};
  const secs = e.ms != null ? `${(e.ms / 1000).toFixed(1)}초` : "";
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
    $(".st", card).innerHTML = pending ? `<span class="spin"></span>` : `<span class="ok">✓</span>`;
    return;
  }
  let st = `<span class="ok">✓</span> ${secs}`;
  if (["concat", "add_music", "export_final", "measure", "probe"].includes(e.name) && r.duration != null) {
    st = `<span class="ok">✓</span> ${r.width ?? ""}${r.width ? "×" : ""}${r.height ?? ""} · ${r.fps ?? ""}fps · ${Number(r.duration).toFixed(3)}s`;
    if (r.loudness) st += ` · ${r.loudness.integrated_lufs} LUFS`;
  }
  $(".st", card).innerHTML = st;
  if (e.name === "list_clips") {
    const items = [...(r.videos ?? []).map((v) => ({ f: v.file, cap: `${v.file.split("/").pop().slice(0, 10)} · ${Number(v.duration).toFixed(1)}s` })), ...(r.images ?? []).slice(0, 6).map((f) => ({ f, cap: f.split("/").pop().slice(0, 12) }))];
    if (items.length) card.insertAdjacentHTML("beforeend", `<div class="tool-b"><div class="strip" style="grid-template-columns:repeat(${Math.min(6, Math.max(3, items.length))},1fr)">${items.slice(0, 12).map((x) => `<figure><img src="${thumbUrl(x.f)}" alt=""><figcaption>${esc(x.cap)}</figcaption></figure>`).join("")}</div>${r.music?.length ? `<div class="muted" style="margin-top:8px">♪ ${r.music.map((m) => `${esc(m.file)} · ${Number(m.duration).toFixed(1)}s`).join(", ")}</div>` : ""}</div>`);
  }
  if (e.name === "make_keyframes" && r.files) {
    card.insertAdjacentHTML("beforeend", `<div class="tool-b"><div class="strip" style="grid-template-columns:repeat(${Math.min(4, r.files.length)},1fr)">${r.files.map((f, i) => `<figure><img src="${fileUrl(f)}" alt="" data-zoom="${fileUrl(f)}"><figcaption>${i + 1}</figcaption></figure>`).join("")}</div></div>`);
    $(".st", card).innerHTML = `<span class="ok">✓</span> ${r.files.length}장 · $${(r.cost_usd ?? 0).toFixed(3)}`;
  }
  if (e.name === "generate_video") {
    if (r.approved === false) $(".st", card).innerHTML = `<span style="color:var(--muted)">취소함</span>`;
    else if (r.file) { $(".st", card).innerHTML = `<span class="ok">✓</span> ${fmtS(r.duration)} · ${r.credits_used ?? "?"}크레딧`; card.insertAdjacentHTML("beforeend", `<div class="tool-b"><video src="${fileUrl(r.file)}" controls muted style="width:100%;border-radius:8px"></video></div>`); }
  }
  if (e.name === "ask_pick") $(".st", card).innerHTML = `<span class="ok">✓</span> 골랐음`;
}

function renderAsk(e, live) {
  // 질문 카드는 tool_call 카드 바로 아래에 붙인다
  const activeNow = live || S.job?.running;
  if (e.kind === "pick") {
    const card = addEl(`<div class="tool" data-ask="${e.ask_id}"><div class="tool-b">
      <div class="pickq">${esc(e.question)}</div>
      <div class="strip pickable" style="grid-template-columns:repeat(${Math.min(4, e.files.length)},1fr)">${e.files.map((f, i) => `<figure data-f="${esc(f)}"><img src="${/\.(mp4|mov|webm)$/i.test(f) ? thumbUrl(f) : fileUrl(f)}" alt=""><figcaption>${i + 1}</figcaption></figure>`).join("")}</div>
      <div class="pickacts"><button class="btn pri" disabled>이걸로</button><button class="btn ghost">다시 그려 줘</button><span class="note">사진을 눌러 고르세요</span></div></div></div>`);
    let chosen = null;
    for (const fig of card.querySelectorAll("figure")) fig.onclick = () => {
      if (card.dataset.done) return;
      card.querySelectorAll("figure").forEach((x) => { x.classList.remove("pick"); x.removeAttribute("data-n"); });
      fig.classList.add("pick"); fig.dataset.n = "✓"; chosen = fig.dataset.f; $(".pri", card).disabled = false;
    };
    $(".pri", card).onclick = () => chosen && answer(e.ask_id, chosen);
    $(".ghost", card).onclick = () => answer(e.ask_id, "마음에 드는 게 없어요. 다른 느낌으로 다시 그려 주세요.");
    if (!activeNow) { card.dataset.done = 1; $(".pickacts", card).innerHTML = `<span class="note">지난 질문</span>`; }
  } else if (e.kind === "approve") {
    const after = e.balance != null && e.credits != null ? `· ${e.balance} → ${Math.round((e.balance - e.credits) * 100) / 100}` : "";
    const short = e.balance != null && e.credits != null && e.balance < e.credits;
    const card = addEl(`<div class="approve" data-ask="${e.ask_id}">
      <div class="h">⏵ ${esc(e.title)} <span class="pill">크레딧 허락 필요</span></div>
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
    const yes = e.value === "yes";
    $(".acts", card).innerHTML = `<span class="btn ${yes ? "vio done" : "ghost"}">${yes ? "✓ 생성하기" : "생성 안 함"}</span><span class="note">${t} 답함 · 허락 없이는 크레딧을 쓰지 않아요</span>`;
  } else {
    for (const fig of card.querySelectorAll("figure")) { const on = fig.dataset.f === e.value; fig.classList.toggle("pick", on); if (on) fig.dataset.n = "✓"; }
    $(".pickacts", card).innerHTML = `<span class="note">${t} · ${card.querySelector(".pick") ? "골랐어요" : esc(e.value)}</span>`;
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
  addEl(`<div class="tool"><div class="tool-h"><span class="ic">▦</span><span class="nm">8fps 검수 시트</span><span class="fn">${esc(e.file)} · ${e.frames[0]?.t ?? 0}s부터</span><span class="st">${e.frames.length}장</span></div>
    <div class="tool-b"><div class="sheet" style="grid-template-columns:repeat(${Math.min(8, e.frames.length)},1fr)">${e.frames.map((f) => `<figure><img src="${fileUrl(f.file)}" data-zoom="${fileUrl(f.file)}" alt=""><figcaption>${f.t.toFixed(3)}</figcaption></figure>`).join("")}</div></div></div>`);
}

function renderDone(e) {
  const v = e.verify;
  if (v) {
    const L = v.loudness;
    const okLen = true;
    addEl(`<div class="result">
      <div class="result-h">✓ 결과를 프로그램이 직접 쟀어요 <span class="pill mint">${(e.seconds ?? 0)}초 · $${(e.cost_usd ?? 0).toFixed(4)}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="k">길이</div><div class="v">${Number(v.duration).toFixed(3)}<small> 초</small></div><div class="t">${v.width}×${v.height} · ${v.fps}fps</div></div>
        <div class="kpi"><div class="k">음량</div><div class="v">${L ? L.integrated_lufs : "—"}<small> LUFS</small></div><div class="t" style="${L && Math.abs(L.integrated_lufs + 14) > 1 ? "color:var(--amber)" : ""}">유튜브 기준 −14 ${L && Math.abs(L.integrated_lufs + 14) <= 1 ? "✓" : ""}</div></div>
        <div class="kpi"><div class="k">트루피크</div><div class="v">${L ? L.true_peak_db : "—"}<small> dBTP</small></div><div class="t" style="${L && L.true_peak_db > -1 ? "color:var(--amber)" : ""}">−1 이하 ${L && L.true_peak_db <= -1 ? "✓" : ""}</div></div>
      </div>
      <div class="file">${esc(v.file)} · ${(v.size / 1048576).toFixed(1)}MB <button class="btn" data-play="${esc(v.file)}">▶ 재생</button><button class="btn ghost" data-open>폴더 열기</button></div></div>`);
    void okLen;
  } else if (e.cost_usd) {
    addEl(`<div class="muted">이번 지시 $${e.cost_usd.toFixed(4)} · ${e.seconds}초</div>`);
  }
}

function renderPlan() {
  const p = S.plan;
  if (!p) { $("#plan").innerHTML = ""; return; }
  $("#plan").innerHTML = p.steps.map((s, i) => `<span class="s ${i < p.done ? "done" : i === p.done && S.running ? "now" : ""}"><span class="b">${i < p.done ? "✓" : ""}</span>${esc(s)}</span>`).join("");
}
function renderFoot() {
  const rl = S.st?.relay;
  $("#foot").innerHTML = S.jobId ? `<span>Enter 보내기 · Shift+Enter 줄바꿈 · 파일은 이 칸에 끌어다 놓기</span><span style="margin-left:auto">이번 지시 <b class="mono" style="color:var(--sub)">$${S.runCost.toFixed(4)}</b>${rl && !rl.error ? ` · 남은 한도 $${rl.remaining_usd.toFixed(2)}` : ""}</span>` : "";
}
function renderSend() {
  const b = $("#send");
  b.classList.toggle("stop", S.running);
  b.textContent = S.running ? "■" : "↑";
  b.title = S.running ? "멈추기" : "보내기 (Enter)";
  b.disabled = !S.jobId;
  $("#input").disabled = !S.jobId;
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
  const n = [...S.gens.values()].filter((g) => g.state !== "done").length;
  $('[data-tab="gen"]').innerHTML = `생성${n ? ` <span class="n">${n}</span>` : ""}`;
  if (!S.job) { rb.innerHTML = `<div class="muted">작업을 고르거나 새로 만들면 여기에 미리보기가 나옵니다.</div>`; return; }
  const files = S.job.files ?? [];
  if (S.tab === "preview") {
    const out = S.job.output ?? files.find((f) => f.kind === "video")?.file;
    const concat = lastArgs("concat"); const music = lastArgs("add_music");
    // 중간 파일(tmp/) 길이는 파일 목록에 없으니 도구 결과에서 찾는다
    const durs = new Map(files.map((x) => [x.file, x.duration]));
    for (const ev of S.job.events ?? []) if (ev.type === "tool_result" && ev.result?.file && ev.result.duration != null) durs.set(ev.result.file, ev.result.duration);
    const segs = (concat?.inputs ?? []).map((f) => ({ f, d: durs.get(f) ?? 1 }));
    const total = segs.reduce((a, s) => a + s.d, 0) || 1;
    const v = S.verify;
    rb.innerHTML = `
      <div class="player">${out ? `<video id="pv" src="${fileUrl(out)}" preload="metadata"></video><span class="tc" id="tc">00:00.00</span><span class="badge">${out.startsWith("out/") ? "결과" : "원본"} · ${esc(out.split("/").pop())}</span>` : `<div class="empty-p">아직 결과가 없어요</div>`}</div>
      ${out ? `<div class="ctrl"><button class="play" id="pp">▶</button><span id="tt">0.00 / 0.00</span><span class="sp"></span><button id="full">⤢ 크게</button></div>` : ""}
      ${segs.length ? `<div class="tl"><div class="ruler">${[0, .2, .4, .6, .8, 1].map((k) => `<span>${(total * k).toFixed(0)}</span>`).join("")}</div>
        <div class="lane"><span class="lb">V1</span><div class="trk">${segs.map((s) => `<div class="clip" style="flex:${s.d};background-image:url('${thumbUrl(s.f)}')"><span>${esc(s.f.split("/").pop().replace(/\.\w+$/, "").slice(0, 10))}</span></div>`).join("")}</div></div>
        ${music ? `<div class="lane"><span class="lb">A1</span><div class="trk"><div class="aud"><svg id="wave" viewBox="0 0 400 40" preserveAspectRatio="none"></svg></div></div></div>` : ""}
        <div class="playhead" id="ph"></div></div>` : ""}
      <div class="sec-t">측정값 <span class="r">프로그램이 직접 잼</span></div>
      ${v ? `<div class="mtable">
        <span class="k">길이</span><span class="v">${Number(v.duration).toFixed(3)} s</span><span class="ok">✓</span>
        <span class="k">해상도 · fps</span><span class="v">${v.width}×${v.height} · ${v.fps}</span><span class="ok">✓</span>
        <span class="k">통합 음량</span><span class="v">${v.loudness?.integrated_lufs ?? "—"} LUFS</span><span class="ok">${v.loudness && Math.abs(v.loudness.integrated_lufs + 14) <= 1 ? "✓" : ""}</span>
        <span class="k">트루피크</span><span class="v">${v.loudness?.true_peak_db ?? "—"} dBTP</span><span class="ok">${v.loudness && v.loudness.true_peak_db <= -1 ? "✓" : ""}</span></div>` : `<div class="muted">내보내기가 끝나면 길이와 음량을 여기에 보여 줍니다.</div>`}`;
    if (music) drawWave();
    const pv = $("#pv");
    if (pv) {
      const tick = () => {
        const t = pv.currentTime, d = pv.duration || 0;
        $("#tc").textContent = `00:${String(Math.floor(t)).padStart(2, "0")}.${String(Math.floor((t % 1) * 100)).padStart(2, "0")}`;
        $("#tt").textContent = `${t.toFixed(2)} / ${d.toFixed(2)}`;
        $("#ph")?.style.setProperty("--ph", d ? t / d : 0);
        $("#pp").textContent = pv.paused ? "▶" : "❚❚";
      };
      ["timeupdate", "play", "pause", "loadedmetadata"].forEach((k) => pv.addEventListener(k, tick));
      $("#pp").onclick = () => (pv.paused ? pv.play() : pv.pause());
      pv.onclick = () => (pv.paused ? pv.play() : pv.pause());
      $("#full").onclick = () => pv.requestFullscreen?.();
      rb.querySelectorAll(".clip").forEach((c, i) => c.onclick = () => { pv.currentTime = segs.slice(0, i).reduce((a, s) => a + s.d, 0) + 0.01; });
    }
  } else if (S.tab === "gen") {
    const gens = [...S.gens.values()].reverse();
    const hf = S.st?.hf ?? {};
    rb.innerHTML = `<div class="sec-t">생성 대기열 <span class="r">${hf.logged_in ? `힉스필드 ${hf.credits ?? "?"}크레딧` : "힉스필드 로그인 필요"}</span></div>
      ${gens.length ? gens.map((g) => `<div class="q">${g.thumb ? `<img src="${fileUrl(g.thumb)}" alt="">` : `<div class="ph"></div>`}<div>
        <div class="t">${esc(g.name)} <span class="r" style="color:${g.state === "done" ? "var(--mint)" : "var(--violet)"}">${g.state === "done" ? "✓ 완료" : g.state === "submitted" ? "보냄" : `생성 중 ${g.elapsed ?? 0}초`}</span></div>
        <div class="m">${esc(g.label ?? "")} · ${g.credits ?? "?"}크레딧</div>
        ${g.state !== "done" ? `<div class="prog"><i style="width:${Math.min(95, ((g.elapsed ?? 0) / 120) * 100)}%"></i></div>` : ""}</div></div>`).join("")
        : `<div class="muted">"흙공이 갯벌에 떨어지는 5초 장면 만들어 줘"처럼 말하면, 사진을 먼저 그려 고르게 한 뒤 크레딧 허락을 받고 클링으로 생성합니다.</div>`}
      <div class="mtable"><span class="k">사진(키프레임)</span><span class="v">강사 API · 크레딧 0</span><span></span><span class="k">Kling 3.0 · 5초</span><span class="v">6.25 크레딧</span><span></span><span class="k">Kling 2.6 · 5초</span><span class="v">5 크레딧</span><span></span></div>`;
  } else if (S.tab === "review") {
    const sh = S.sheet;
    rb.innerHTML = sh ? `<div class="sec-t">8fps 검수 <span class="r">${esc(sh.file)}</span></div>
      <div class="big-sheet">${sh.frames.map((f) => `<figure><img src="${fileUrl(f.file)}" data-zoom="${fileUrl(f.file)}" alt=""><figcaption>${f.t.toFixed(3)}s</figcaption></figure>`).join("")}</div>
      <div class="muted">사진을 누르면 크게 봅니다. 착지·전환 순간이 이상하면 "다시 뽑아 줘" 또는 "1.5초 앞에서 잘라 줘"라고 말하세요.</div>`
      : `<div class="muted">생성한 컷의 움직임을 1초 8장으로 쪼개 보여 줍니다. "C05를 1초부터 검수해 줘"라고 말해 보세요.</div>`;
  } else {
    rb.innerHTML = `<div class="drop" id="drop">여기에 클립·음악·사진을 끌어다 놓거나 눌러서 고르세요</div>
      <div class="files">${files.map((f) => `<div class="frow" data-f="${esc(f.file)}" data-k="${f.kind}">
        ${f.kind === "audio" ? `<div class="ic2">♪</div>` : `<img src="${thumbUrl(f.file)}" alt="">`}
        <div><div class="nm">${esc(f.file)}</div><div class="m">${f.kind === "image" ? "사진" : `${Number(f.duration ?? 0).toFixed(2)}s${f.width ? ` · ${f.width}×${f.height}` : ""}`} · ${(f.size / 1048576).toFixed(1)}MB</div></div>
        <span class="muted">${f.file.startsWith("out/") ? "결과" : ""}</span></div>`).join("")}</div>
      <button class="btn ghost" data-open>📂 작업 폴더 열기</button>`;
    $("#drop").onclick = () => $("#filePick").click();
    bindDrop($("#drop"));
    rb.querySelectorAll(".frow").forEach((r) => r.onclick = () => lightbox(r.dataset.k === "image" ? fileUrl(r.dataset.f) : null, r.dataset.k !== "image" ? fileUrl(r.dataset.f) : null));
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
    if (f.size>2*1024**3) {toast('파일 하나의 크기는 2GB까지 지원합니다.');continue;}
    try {
      const chunkSize=16*1024*1024;
      for(let offset=0;offset<f.size || (offset===0 && f.size===0);offset+=chunkSize) {
        const end=Math.min(f.size,offset+chunkSize);
        const r=await fetch(`/api/jobs/${encodeURIComponent(S.jobId)}/upload?name=${encodeURIComponent(f.name)}&offset=${offset}&final=${end===f.size}`,{method:'PUT',body:f.slice(offset,end)});
        if(!r.ok) throw new Error((await r.json()).error ?? `업로드 오류 ${r.status}`);
      }
    } catch(e) {toast(`${f.name}: ${e.message}`,5000);}
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
  return `<div class="cx-h">${back ? `<button class="btn ghost" id="cxBack">← 목록</button>` : ""}<div><h3>${title}</h3><p>${sub}</p></div><button class="x" id="cxClose">✕</button></div>`;
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

function renderCxList() {
  CX.el.innerHTML = `<div class="cx">${cxHead("커넥터", "무덱스가 바깥 서비스의 도구를 쓰게 연결합니다. 클로드의 '커넥터 추가'와 같은 방식(원격 MCP)입니다.")}
    <div class="cx-b">
    ${CX.list.map((c) => `<div class="cc"><div class="av ${c.connected ? "on" : ""}">${esc(c.name[0] ?? "?")}</div>
      <div><div class="nm">${esc(c.name)} ${c.practice ? `<span class="pill amber">연습 모드</span>` : ""} ${c.connected ? `<span class="pill mint">● 연결됨${c.tools_count ? ` · 도구 ${c.tools_count}` : ""}</span>` : c.logging_in ? `<span class="pill violet">로그인 기다리는 중…</span>` : `<span class="pill">연결 안 됨</span>`}</div><div class="u">${esc(c.url)}</div></div>
      <div class="acts" data-id="${c.id}">${c.connected ? `<button class="btn" data-a="tools">도구 보기</button><button class="btn ghost" data-a="disconnect">연결 끊기</button>` : `<button class="btn vio" data-a="connect">연결</button>`}<button class="btn ghost" data-a="remove" title="목록에서 빼기">🗑</button></div></div>`).join("")}
    <div class="addf"><b>＋ 커스텀 커넥터 추가</b>
      <label>이름<input type="text" id="cxName" placeholder="예) Higgsfield"></label>
      <label>원격 MCP 서버 주소<input type="text" id="cxUrl" placeholder="https://…/mcp"></label>
      <label class="chk"><input type="checkbox" id="cxPractice"> 연습 모드 — 계정 없이 같은 흐름을 해 봅니다(실제로는 연결하지 않음)</label>
      <div class="row"><button class="btn pri" id="cxAdd">추가</button><button class="btn ghost" id="cxFill">힉스필드 주소 넣기</button><span class="msg" id="cxMsg"></span></div>
    </div>
    <div class="howto"><b>순서</b> ① 이름과 MCP 서버 주소를 넣고 추가 → ② <b>연결</b>을 누르면 브라우저에 로그인 창이 뜹니다 → ③ 로그인하고 <b>허용</b> → ④ 무덱스로 돌아오면 <b>연결됨</b>, 도구 목록이 보입니다 → ⑤ <b>balance</b> 같은 조회 도구를 눌러 첫 호출을 해 봅니다.<br>
    힉스필드 주소: <span class="mono">https://mcp.higgsfield.ai/mcp</span> · 로그인은 OAuth라 무덱스는 비밀번호를 보지 않고, 받은 토큰은 이 PC의 data 폴더에만 저장됩니다.</div>
    </div></div>`;
  $("#cxFill").onclick = () => { $("#cxName").value = "Higgsfield"; $("#cxUrl").value = "https://mcp.higgsfield.ai/mcp"; };
  $("#cxAdd").onclick = async () => {
    try { await api("POST", "/api/connectors", { name: $("#cxName").value, url: $("#cxUrl").value, practice: $("#cxPractice").checked }); await loadConnectors(); }
    catch (e) { $("#cxMsg").textContent = e.message; }
  };
  CX.el.querySelectorAll(".acts button").forEach((b) => b.onclick = async () => {
    const id = b.parentElement.dataset.id, a = b.dataset.a;
    try {
      if (a === "connect") {
        const popup=S.st?.cloud ? window.open('about:blank','mudex-login','popup,width=600,height=780') : null;
        b.disabled=true;b.textContent='창 여는 중…';
        try {const j=await api('POST',`/api/connectors/${id}/connect`);if(popup)popup.location.href=j.url;else if(S.st?.cloud)location.href=j.url;}
        catch(e) {popup?.close();throw e;}
        toast("브라우저에서 로그인하고 '허용'을 눌러 주세요.",5000);await loadConnectors();
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
  try { S.st = await api("GET", "/api/state"); } catch { S.st = null; }
  if (S.st) $("#model").value = `${S.st.model}|${S.st.effort}`;
  renderSide(); renderFoot();
  if (!S.jobId) renderEmpty();
}

async function refreshJob() {
  if (!S.jobId) return;
  const j = await api("GET", `/api/jobs/${encodeURIComponent(S.jobId)}`);
  S.job = { ...S.job, ...j };
  renderTop(); renderRight();
}

async function openJob(id) {
  S.jobId = id; localStorage.setItem("mudex.job", id);
  S.es?.close();
  S.cards.clear(); S.gens.clear(); S.plan = null; S.sheet = null; S.verify = null; S.runCost = 0; S.lastTrimCard = null;
  let j;
  try { j = await api("GET", `/api/jobs/${encodeURIComponent(id)}`); }
  catch { S.jobId = null; localStorage.removeItem("mudex.job"); renderEmpty(); return; }
  S.job = j; S.running = j.running;
  $("#feed").innerHTML = `<div class="col"></div>`;
  if (!j.events.length) addEl(`<div class="say">새 작업입니다. 오른쪽 <b>파일</b> 칸이나 아래 입력창에 클립·음악·사진을 끌어다 놓고, 하고 싶은 걸 말해 주세요.\n예) “세 클립을 이어 붙여 18초로 만들고 음악 얹어서 내보내 줘”\n예) “갯벌에 흙공이 떨어지는 5초 장면을 만들어 줘”</div>`);
  for (const e of j.events) renderEvent(e, false);
  if (S.running) addEl(`<div class="thinking"><i></i><i></i><i></i> 무덱스가 일하는 중</div>`);
  renderPlan(); renderTop(); renderSend(); renderFoot(); renderSide(); renderRight();
  scrollFeed();
  S.es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  S.es.onmessage = (m) => { const e = JSON.parse(m.data); S.job.events.push(e); renderEvent(e, true); };
}

async function send() {
  if (S.running) { await api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/stop`).catch(() => {}); return; }
  const t = $("#input").value.trim();
  if (!t || !S.jobId) return;
  if (!S.st?.code_set) return askCode();
  $("#input").value = ""; autosize();
  try { await api("POST", `/api/jobs/${encodeURIComponent(S.jobId)}/run`, { text: t }); }
  catch (e) { toast(e.message); $("#input").value = t; }
}
function autosize() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(180, t.scrollHeight) + "px"; }

// ---------- 묶기 ----------
$("#newJob").onclick = newJob;
$("#openCx").onclick = () => openConnectors();
$("#send").onclick = send;
$("#input").addEventListener("input", autosize);
$("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$("#addFile").onclick = () => $("#filePick").click();
$("#filePick").onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ""; };
$("#model").onchange = (e) => { const [model, effort] = e.target.value.split("|"); api("POST", "/api/model", { model, effort }); };
bindDrop($("#composer"));
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));
document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.key.toLowerCase() === "n") { e.preventDefault(); newJob(); } });
document.addEventListener("click", (e) => {
  const z = e.target.closest("[data-zoom]"); if (z) return lightbox(z.dataset.zoom);
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
renderSend();
const stReady = refreshState();
if (S.jobId) await openJob(S.jobId); else { renderEmpty(); renderRight(); }
await stReady;
if (S.st && !S.st.code_set) askCode();
