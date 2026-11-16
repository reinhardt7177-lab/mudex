// 무덱스 강사 화면: 공용 비밀번호로 들어와 연수를 만들고, 연수 코드·QR을 띄우고, 연수생을 보고, 끝나면 폐기한다.
// 비밀번호는 이 탭(sessionStorage)에만 두고, 서버는 해시로만 비교한다.
const RELAY = "https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay";
const SITE = location.origin;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const USD_KRW_RATE = 1335; // 이미지 비용과 같은 표시용 참고 환율, 2026-11-16 기준
const money = (usd) => {
  const amount = Number(usd ?? 0);
  return `<span class="money"><span>$${amount.toFixed(2)}</span><small>약 ${Math.round(amount * USD_KRW_RATE).toLocaleString("ko-KR")}원</small></span>`;
};
const hm = (d) => new Date(d).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const md = (d) => new Date(d).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
const ago = (d) => { if (!d) return "—"; const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? "방금" : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : md(d); };
let PW = sessionStorage.getItem("mudex.teacher") ?? "";
let selected = null, timer = null;

async function T(method, path, body) {
  const r = await fetch(RELAY + path, { method, headers: { "x-admin-password": PW, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { PW = ""; sessionStorage.removeItem("mudex.teacher"); }
  if (!r.ok) throw new Error(j.error?.message ?? `오류 ${r.status}`);
  return j;
}
const qrSvg = (text, cell = 6) => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: cell, margin: 0, scalable: true }); };
const joinUrl = (c) => `${SITE}/?j=${c.entry_code}`;

// ---------- 로그인 ----------
function renderLogin(msg = "") {
  clearInterval(timer);
  $("#app").innerHTML = `<div class="login"><div class="login-card">
    <div class="mark"></div><h1>무덱스 강사</h1><p class="sub">강사 비밀번호를 넣어 주세요.</p>
    <form id="f"><input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="강사 비밀번호"><div class="msg" role="alert">${esc(msg)}</div><button class="btn pri" type="submit">들어가기</button></form>
    <a class="back" href="/">무덱스로</a></div></div>`;
  $("#pw").focus();
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    PW = $("#pw").value;
    try { await T("POST", "/teacher/login"); sessionStorage.setItem("mudex.teacher", PW); renderHome(); }
    catch (err) { renderLogin(err.message); }
  };
}

// ---------- 목록 + 상세 ----------
async function renderHome() {
  $("#app").innerHTML = `<div class="shell">
    <header class="top"><div class="brand"><div class="mark sm"></div><b>무덱스 강사</b></div><span class="sp"></span>
      <button class="btn" id="useMudex">무덱스 열기(강사용)</button><button class="btn ghost" id="lock">잠그기</button></header>
    <div class="body">
      <section class="left">
        <h1>연수</h1>
        <form class="new" id="newF">
          <label>연수 이름<input id="nName" value="광주 AI·SW 2기 · ${md(new Date())}" maxlength="40"></label>
          <div class="two">
            <label>끝나는 시각<input id="nEnds" type="datetime-local"></label>
            <label>전체 안전선($)<input id="nBudget" type="number" min="1" step="1" value="30" placeholder="비우면 없음"></label>
          </div>
          <p class="hint">연수생 개인 한도는 없습니다. 연수 전체 사용액이 안전선에 닿으면 멈춥니다. 끝나는 시각이 되면 코드가 저절로 폐기됩니다.</p>
          <button class="btn pri" type="submit">연수 만들기</button>
        </form>
        <div id="list" class="list"><div class="muted">불러오는 중…</div></div>
      </section>
      <section class="right" id="detail"><div class="empty muted">왼쪽에서 연수를 고르거나 새로 만드세요.</div></section>
    </div></div>`;
  const end = new Date(); end.setHours(Math.max(end.getHours() + 3, 17), 30, 0, 0);
  $("#nEnds").value = new Date(end - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#lock").onclick = () => { PW = ""; sessionStorage.removeItem("mudex.teacher"); renderLogin(); };
  $("#useMudex").onclick = async () => { const w = window.open("about:blank", "_blank"); try { const { code } = await T("POST", "/teacher/self-code"); w.location.href = `${SITE}/?code=${encodeURIComponent(code)}`; } catch (e) { w.close(); alert(e.message); } };
  $("#newF").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("#nBudget").value.trim();
    try {
      const { cohort } = await T("POST", "/teacher/cohorts", { name: $("#nName").value, ends_at: new Date($("#nEnds").value).toISOString(), budget_usd: b === "" ? null : Number(b) });
      selected = cohort.id; await loadList(); await loadDetail();
    } catch (err) { alert(err.message); }
  };
  await loadList();
  if (selected) await loadDetail();
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === "visible") { loadList(); if (selected) loadDetail(true); } }, 10000);
}

async function loadList() {
  let j;
  try { j = await T("GET", "/teacher/cohorts"); } catch (e) { return PW ? ($("#list").innerHTML = `<div class="err">${esc(e.message)}</div>`) : renderLogin(e.message); }
  const rows = j.cohorts;
  if (!selected && rows.find((c) => c.open)) selected = rows.find((c) => c.open).id;
  $("#list").innerHTML = rows.length ? rows.map((c) => `<button class="row ${c.id === selected ? "on" : ""}" data-id="${c.id}">
      <span class="rn">${esc(c.name)}</span><span class="pill ${c.open ? "live" : ""}">${c.open ? "진행 중" : "끝남"}</span>
      <span class="rm"><span class="code">${esc(c.entry_code)}</span> · ${c.trainees}명 · ${money(c.spent)}${c.budget_usd != null ? ` / ${money(c.budget_usd)}` : ""} · ${md(c.ends_at)} ${hm(c.ends_at)}까지</span></button>`).join("")
    : `<div class="muted">아직 만든 연수가 없어요.</div>`;
  document.querySelectorAll(".row").forEach((b) => (b.onclick = () => { selected = b.dataset.id; loadList(); loadDetail(); }));
}

async function loadDetail(quiet) {
  let j;
  try { j = await T("GET", `/teacher/cohorts/${selected}`); } catch (e) { if (!quiet) $("#detail").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const c = j.cohort, t = j.trainees;
  const spent = t.reduce((s, x) => s + x.spent, 0);
  const remaining = c.budget_usd == null ? null : Math.max(0, c.budget_usd - spent);
  const pct = c.budget_usd ? Math.min(100, (spent / c.budget_usd) * 100) : 0;
  $("#detail").innerHTML = `
    <div class="dh"><div><h2>${esc(c.name)}</h2><p class="muted">${c.open ? `${md(c.ends_at)} ${hm(c.ends_at)}에 저절로 끝납니다` : "끝난 연수입니다. 코드는 모두 폐기되었습니다."}</p></div>
      <span class="pill ${c.open ? "live" : ""}">${c.open ? "진행 중" : "끝남"}</span></div>
    ${c.open ? `<div class="entrybox">
      <div class="qr">${qrSvg(joinUrl(c))}</div>
      <div class="ei"><div class="k">연수 코드</div><div class="ec">${esc(c.entry_code)}</div><div class="url">${esc(SITE.replace(/^https?:\/\//, ""))}</div>
        <div class="acts"><button class="btn pri" id="present">프로젝터로 띄우기</button><button class="btn" id="copy">입장 주소 복사</button></div></div></div>` : ""}
    <div class="stats">
      <div><div class="k">들어온 연수생</div><div class="v">${t.length}<small>명</small></div></div>
      <div><div class="k">쓴 돈</div><div class="v">${money(spent)}</div></div>
      <div><div class="k">남은 한도</div><div class="v">${remaining == null ? "제한 없음" : money(remaining)}</div></div>
      <div><div class="k">연수 전체 안전선</div><div class="v">${c.budget_usd != null ? money(c.budget_usd) : "없음"}</div>${c.budget_usd != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ""}</div>
    </div>
    <p class="hint fx-note">원화는 1달러=${USD_KRW_RATE.toLocaleString("ko-KR")}원(2026-11-16 기준)으로 환산한 참고 금액입니다. 실제 청구는 달러 기준이며 세금·결제 수수료는 별도입니다.</p>
    <div class="sec">연수생 <span class="muted">10초마다 새로 고침</span></div>
    <div class="table">${t.length ? `<div class="tr th"><span>이름</span><span>들어온 시각</span><span class="num">쓴 돈</span><span>마지막 사용</span><span></span></div>` + t.map((x) => `<div class="tr ${x.disabled ? "off" : ""}">
        <span class="nm">${esc(x.name)}</span><span>${hm(x.joined_at)}</span><span class="num">${money(x.spent)}</span><span>${ago(x.last_used_at)}</span>
        <span class="ra">${x.disabled ? `<span class="muted">꺼짐</span>` : c.open ? `<button class="btn ghost sm" data-off="${esc(x.code)}" data-n="${esc(x.name)}">끄기</button>` : ""}</span></div>`).join("")
      : `<div class="tr empty"><span class="muted">아직 들어온 연수생이 없어요. 연수 코드나 QR을 띄워 주세요.</span></div>`}</div>
    ${c.open ? `<div class="danger"><div><b>연수 끝내기</b><p class="muted">이 연수의 코드 ${t.length}개가 바로 폐기되고, 더는 들어올 수 없습니다. 되돌릴 수 없습니다.</p></div><button class="btn danger-btn" id="close">연수 끝내기</button></div>` : ""}`;
  $("#present")?.addEventListener("click", () => present(c));
  $("#copy")?.addEventListener("click", async () => { await navigator.clipboard.writeText(joinUrl(c)); $("#copy").textContent = "복사했어요"; });
  $("#close")?.addEventListener("click", async () => {
    if (!confirm(`'${c.name}'을 끝낼까요? 코드 ${t.length}개가 폐기됩니다.`)) return;
    await T("POST", `/teacher/cohorts/${c.id}/close`); await loadList(); await loadDetail();
  });
  document.querySelectorAll("[data-off]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`${b.dataset.n} 선생님의 코드를 끌까요?`)) return;
    await T("POST", "/teacher/codes/disable", { code: b.dataset.off }); loadDetail();
  }));
}

// 프로젝터용: 연수 코드와 QR을 크게
function present(c) {
  const el = document.createElement("div");
  el.className = "present";
  el.innerHTML = `<button class="x" aria-label="닫기">닫기 Esc</button>
    <div class="pin"><div class="mark"></div><div class="pt">무덱스에 들어오세요</div></div>
    <div class="pmain"><div class="pq">${qrSvg(joinUrl(c), 10)}</div>
      <div class="pi"><div class="k">주소</div><div class="pu">${esc(SITE.replace(/^https?:\/\//, ""))}</div><div class="k">연수 코드</div><div class="pc">${esc(c.entry_code)}</div><div class="pn">${esc(c.name)}</div></div></div>`;
  document.body.append(el);
  el.requestFullscreen?.().catch(() => {});
  const close = () => { el.remove(); if (document.fullscreenElement) document.exitFullscreen(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  $(".x", el).onclick = close; document.addEventListener("keydown", onKey);
}

PW ? T("POST", "/teacher/login").then(renderHome, () => renderLogin()) : renderLogin();
