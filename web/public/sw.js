// 미리보기 서비스 워커: /f/<프로젝트>/<경로> 를 브라우저 저장소(OPFS)에서 꺼내 준다.
// 그래서 에이전트가 만든 웹페이지가 상대 경로(그림·css·js)까지 그대로 열린다.
// /thumb/… 는 사진이면 그 사진을, 영상이면 화면이 만들어 둔 .mudex/thumbs/ 그림을 준다.
const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
};
const mimeOf = (p) => MIME[p.split(".").pop().toLowerCase()] ?? "application/octet-stream";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data?.type === "mudex-claim") e.waitUntil(self.clients.claim()); });

async function getFile(parts) {
  let d = await navigator.storage.getDirectory();
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await d.getFileHandle(parts.at(-1))).getFile();
}

// PC 폴더 프로젝트는 서비스 워커가 직접 못 열 수 있어서, 무덱스 화면(창)에게 읽어 달라고 부탁한다
async function askClient(job, rel) {
  const wins = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((c) => !new URL(c.url).pathname.startsWith("/f/"));
  for (const c of wins) {
    const got = await new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 6000);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data?.blob ?? null); };
      c.postMessage({ type: "mudex-read", job, path: rel.join("/") }, [ch.port2]);
    });
    if (got) return got;
  }
  return null;
}

async function serve(req, parts) {
  if (parts.some((p) => p === ".." || p === "")) return new Response("bad path", { status: 400 });
  let file;
  try { file = await getFile(parts); }
  catch {
    file = await askClient(parts[1], parts.slice(2));
    if (!file) return new Response("없는 파일입니다", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const type = mimeOf(parts.at(-1));
  const size = file.size;
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    return new Response(file.slice(start, end + 1), { status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": String(end - start + 1), "Cache-Control": "no-store" } });
  }
  return new Response(file, { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const m = url.pathname.match(/^\/(f|thumb)\/([^/]+)\/(.+)$/);
  if (!m) return;
  const job = decodeURIComponent(m[2]);
  const rel = m[3].split("/").map(decodeURIComponent);
  if (m[1] === "f") return e.respondWith(serve(e.request, ["projects", job, ...rel]));
  // 썸네일: 사진은 그대로, 영상은 미리 만들어 둔 그림
  const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(rel.at(-1));
  const key = rel.join("/").replace(/[^\w.-]/g, "_") + ".jpg";
  e.respondWith(isImg ? serve(e.request, ["projects", job, ...rel]) : serve(e.request, ["projects", job, ".mudex", "thumbs", key]));
});
