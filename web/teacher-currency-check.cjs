const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.argv[2]);

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.join(__dirname, "public", pathname === "/admin" ? "admin.html" : pathname);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] ?? "text/plain" });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.argv[3] });
  try {
    const origin = process.env.MUDEX_CHECK_ORIGIN ?? `http://127.0.0.1:${server.address().port}`;
    const version = process.env.MUDEX_CHECK_VERSION;
    const ends_at = "2026-12-01T09:00:00Z";
    const trainees = [
      { code: "TEST-A", name: "테스트 교사 A", spent: 0.041675, joined_at: ends_at, last_used_at: ends_at },
      { code: "TEST-B", name: "테스트 교사 B", spent: 0.994016, joined_at: ends_at, last_used_at: ends_at },
    ];
    const cohorts = [
      { id: "limited", name: "원화 표시 확인", budget_usd: 50, spent: 1.035691, trainees: 2 },
      { id: "unlimited", name: "한도 없는 연수", budget_usd: null, spent: 0, trainees: 0 },
      { id: "exhausted", name: "한도 소진 연수", budget_usd: 1, spent: 2, trainees: 1 },
    ].map(c => ({ ...c, entry_code: "TEST12", open: false, ends_at }));
    const page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === origin) {
        const headers = { ...request.headers() };
        if (version) headers["Cloudflare-Workers-Version-Overrides"] = `mudex-web="${version}"`;
        return route.continue({ headers });
      }
      if (url.hostname === "cdn.jsdelivr.net") return route.continue();
      const endpoint = url.pathname.split("/mudex-relay")[1];
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      const reply = json => route.fulfill({ json, headers });
      if (endpoint === "/teacher/login") return reply({ ok: true });
      if (endpoint === "/teacher/cohorts" && request.method() === "GET") return reply({ cohorts });
      const id = endpoint?.split("/").at(-1), cohort = cohorts.find(c => c.id === id);
      if (cohort && request.method() === "GET") return reply({ cohort, trainees: id === "limited" ? trainees : id === "exhausted" ? [{ ...trainees[0], spent: 2 }] : [] });
      return route.abort(); // No real accounts, codes or charges are changed.
    });
    await page.goto(origin + "/admin");
    await page.getByLabel("강사 비밀번호").fill("currency-check");
    await page.getByRole("button", { name: "들어가기", exact: true }).click();
    await page.locator('.row[data-id="limited"]').click();
    const stat = label => page.locator(".stats > div").filter({ has: page.locator(".k").getByText(label, { exact: true }) });
    await stat("남은 한도").waitFor();
    assert.match(await stat("쓴 돈").innerText(), /\$1\.04[\s\S]*약 1,383원/);
    assert.match(await stat("남은 한도").innerText(), /\$48\.96[\s\S]*약 65,367원/);
    assert.match(await stat("연수 전체 안전선").innerText(), /\$50\.00[\s\S]*약 66,750원/);
    assert.match(await page.locator('.row[data-id="limited"]').innerText(), /약 1,383원/);
    assert.match(await page.locator(".tr").filter({ hasText: "테스트 교사 A" }).locator(".num").innerText(), /\$0\.04[\s\S]*약 56원/);
    assert.match(await page.locator(".fx-note").innerText(), /1달러=1,335원\(2026-11-16 기준\)/);
    for (const width of [1366, 1024, 800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`);
      if (process.argv[4]) await page.screenshot({ path: `${process.argv[4]}-${width}.png`, fullPage: true });
    }
    await page.locator('.row[data-id="unlimited"]').click();
    await stat("남은 한도").getByText("제한 없음").waitFor();
    assert.match(await stat("쓴 돈").innerText(), /\$0\.00[\s\S]*약 0원/);
    await page.locator('.row[data-id="exhausted"]').click();
    await page.locator("#detail h2").getByText("한도 소진 연수").waitFor();
    assert.match(await stat("남은 한도").innerText(), /\$0\.00[\s\S]*약 0원/);
    assert.deepEqual(errors, []);
    console.log("Teacher USD/KRW spending, remaining budget, trainee totals, unlimited/exhausted budgets, and desktop/tablet/mobile layouts passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
