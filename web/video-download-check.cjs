const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.argv[2]);

const video = fs.readFileSync(process.argv[4]);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] ?? "text/plain" });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.argv[3] });
  try {
    const origin = process.env.MUDEX_CHECK_ORIGIN ?? `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({
      viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      acceptDownloads: true,
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      // 다운로드가 가상 파일 URL의 네트워크 응답에 의존하면 실패하게 한다.
      if (url.origin !== origin || /^\/(f|thumb)\//.test(url.pathname)) return route.abort();
      const headers = { ...request.headers() };
      if (process.env.MUDEX_CHECK_VERSION) headers["Cloudflare-Workers-Version-Overrides"] = `mudex-web="${process.env.MUDEX_CHECK_VERSION}"`;
      return route.continue({ headers });
    });
    await page.goto(origin);
    await page.evaluate(async (base64) => {
      const { Workspace } = await import("/opfs.js");
      const project = new Workspace("태블릿 다운로드 확인");
      const file = "out/우리 반 & 영상.mp4";
      await project.write(file, Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      const events = [
        { type: "tool_call", id: "video", name: "higgsfield_clip", args: {} },
        { type: "tool_result", id: "video", name: "higgsfield_clip", ok: true, result: { file, duration: 1 } },
      ];
      await project.write(".mudex/events.jsonl", events.map((event) => JSON.stringify(event)).join("\n"));
      localStorage.setItem("mudex.job", project.id);
    }, video.toString("base64"));
    await page.goto(origin + "/?entry=1");
    await page.locator("#entry").waitFor();
    await page.locator("#entry").evaluate((el) => el.remove());
    const button = page.locator(".tool").getByRole("button", { name: "영상 다운로드", exact: true });
    await button.waitFor({ timeout: 12000 });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "영상 다운로드" });
    const link = dialog.getByRole("link", { name: "영상 파일 저장", exact: true });
    await link.waitFor();
    assert.match(await link.getAttribute("href"), /^blob:/);
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    assert.equal(download.suggestedFilename(), "우리 반 & 영상.mp4");
    assert.deepEqual(fs.readFileSync(await download.path()), video);
    if (process.argv[5]) await dialog.screenshot({ path: process.argv[5] });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    assert.equal(await dialog.count(), 0);
    console.log("Tablet result card saves the original video bytes and filename through a blob URL.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
