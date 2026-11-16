const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.argv[2]);

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZkAAAAASUVORK5CYII=", "base64");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : url.pathname);
  const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "text/plain" });
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.argv[3] });
  try {
    const origin = process.env.MUDEX_CHECK_ORIGIN ?? `http://127.0.0.1:${server.address().port}`;
    const version = process.env.MUDEX_CHECK_VERSION;
    const page = await browser.newPage({
      acceptDownloads: true, viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || /^\/(f|thumb)\//.test(url.pathname)) return route.abort();
      const headers = { ...request.headers() };
      if (version) headers["Cloudflare-Workers-Version-Overrides"] = `mudex-web="${version}"`;
      return route.continue({ headers });
    });
    await page.goto(origin);
    await page.evaluate(async (image) => {
      const { Workspace } = await import("/opfs.js");
      const project = new Workspace("다운로드 확인");
      const files = ["images/첫 그림.png", "images/두 번째 & 그림.png"];
      const bytes = Uint8Array.from(atob(image), (char) => char.charCodeAt(0));
      await Promise.all(files.map((file) => project.write(file, bytes)));
      const events = [
        { type: "tool_call", id: "draw", name: "make_image", args: { count: 2 } },
        { type: "tool_result", id: "draw", name: "make_image", ok: true, result: { files } },
      ];
      await project.write(".mudex/events.jsonl", events.map((event) => JSON.stringify(event)).join("\n"));
      localStorage.setItem("mudex.job", "다운로드 확인");
    }, png.toString("base64"));
    await page.goto(origin + "/?j=");
    await page.locator("#entry").waitFor();
    await page.locator("#entry").evaluate((el) => el.remove());
    const buttons = page.locator(".tool").getByRole("button", { name: /이미지 다운로드/ });
    await buttons.first().waitFor({ timeout: 3000 }).catch(() => {});
    assert.equal(await buttons.count(), 2, "Each saved image should have a download button");
    await buttons.nth(1).click();
    const dialog = page.getByRole("dialog", { name: "이미지 다운로드" });
    const save = dialog.getByRole("link", { name: "이미지 파일 저장" });
    await save.waitFor();
    assert.match(await save.getAttribute("href"), /^blob:/);
    const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
    assert.equal(download.suggestedFilename(), "두 번째 & 그림.png");
    assert.deepEqual(fs.readFileSync(await download.path()), png);
    if (process.argv[4]) await dialog.screenshot({ path: process.argv[4] });
    await dialog.getByRole("button", { name: "닫기" }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.tab[data-tab="files"]').click();
    await page.locator(".frow").filter({ hasText: "첫 그림.png" }).click();
    await page.locator("#rbody").getByRole("button", { name: "이미지 다운로드" }).click();
    const [previewDownload] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("link", { name: "이미지 파일 저장" }).click()]);
    assert.equal(previewDownload.suggestedFilename(), "첫 그림.png");
    assert.deepEqual(fs.readFileSync(await previewDownload.path()), png);
    console.log("Tablet image card and preview save original filenames and bytes through blob URLs.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
