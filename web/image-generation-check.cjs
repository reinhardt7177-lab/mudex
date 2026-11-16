const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require(process.argv[2]);

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
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const { CORE_TOOLS } = await import("/tools.js");
      const { Workspace } = await import("/opfs.js");
      const tool = CORE_TOOLS.find((entry) => entry.name === "make_image");
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XWZkAAAAASUVORK5CYII=";
      const requests = [], events = [];
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (input !== "https://generation-check.invalid/v1/images/generations") return originalFetch(input, init);
        requests.push(JSON.parse(init.body));
        return Response.json({ data: [{ b64_json: png }], mudex: { cost_usd: 0.125, remaining_usd: 1 } });
      };
      try {
        const ws = new Workspace("이미지 설정 검증");
        const ctx = { ws, relay: "https://generation-check.invalid", code: "test", emit: (event) => events.push(event) };
        const generated = await tool.run({ prompt: "A classroom", path_prefix: "images/test" }, ctx);
        const bytes = Array.from(await ws.readBytes(generated.files[0]));
        await tool.run({ prompt: "A square drawing", path_prefix: "images/square", quality: "medium", size: "1024x1024" }, ctx);
        return { requests, generated, bytes, events };
      } finally {
        window.fetch = originalFetch;
      }
    });
    assert.equal(result.requests[0].model, "gpt-image-2.6-sunburst");
    assert.equal(result.requests[0].quality, "high");
    assert.equal(result.requests[0].size, "1536x1024");
    assert.equal(result.requests[0].n, 1);
    assert.equal(result.requests[1].quality, "medium");
    assert.equal(result.requests[1].size, "1024x1024");
    assert.equal(result.generated.cost_usd, 0.125);
    assert.deepEqual(result.bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(result.events.some((event) => event.type === "cost" && event.cost_usd === 0.125));
    console.log("Sunburst/high defaults, explicit settings, PNG storage, and reported cost passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
