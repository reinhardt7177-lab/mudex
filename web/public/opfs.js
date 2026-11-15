// 프로젝트 저장소 두 가지:
//   1) 브라우저 저장소(OPFS) /projects/<이름>/ : 설치·권한 없이 바로
//   2) 내 PC 폴더 : 엣지·크롬의 "폴더 열기"(File System Access)로 고른 폴더를 그대로 프로젝트로 쓴다.
//      폴더 손잡이(handle)는 IndexedDB에 두고, 브라우저를 다시 열면 한 번 더 허용을 받는다.
// 화면(app.js)·에이전트·서비스 워커(sw.js)가 같은 저장소를 본다.
const root = () => navigator.storage.getDirectory();

export function clean(rel) {
  const parts = String(rel ?? "").replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) throw new Error(`프로젝트 폴더 밖 경로는 쓸 수 없습니다: ${rel}`);
  return parts;
}

async function walkDir(d, parts, create = false) {
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
export async function projectsDir() { return walkDir(await root(), ["projects"], true); }

// ---------- 내 PC 폴더 목록(IndexedDB) ----------
const DB = "mudex", STORE = "local-folders";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = new Map();
    const tx = db.transaction(STORE).objectStore(STORE).openCursor();
    tx.onsuccess = () => { const c = tx.result; if (c) { out.set(c.key, c.value); c.continue(); } else res(out); };
    tx.onerror = () => rej(tx.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export const locals = new Map(); // id → FileSystemDirectoryHandle
export async function loadLocals() { try { for (const [k, v] of await idbAll()) locals.set(k, v); } catch {} }
export const canPickFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// 폴더를 골라 프로젝트로 등록. id는 폴더 이름(겹치면 뒤에 번호).
export async function pickLocalFolder(taken) {
  const h = await window.showDirectoryPicker({ id: "mudex", mode: "readwrite" });
  if ((await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("폴더에 쓰기 허용을 받지 못했습니다.");
  for (const [k, v] of locals) if (await v.isSameEntry(h)) return k;
  let id = h.name, n = 2;
  while (taken.has(id) || locals.has(id)) id = `${h.name} ${n++}`;
  locals.set(id, h);
  await idbPut(id, h);
  return id;
}
export async function forgetLocal(id) { locals.delete(id); await idbDel(id); }
export async function localPermission(id) { const h = locals.get(id); return h ? h.queryPermission({ mode: "readwrite" }) : "granted"; }
export async function grantLocal(id) {
  const h = locals.get(id);
  if (h && (await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("폴더 허용을 받지 못했습니다.");
}

export async function listProjects() {
  const d = await projectsDir();
  const out = [];
  for await (const [name, h] of d.entries()) if (h.kind === "directory") out.push(name);
  return [...out, ...locals.keys()];
}

// 프로젝트 하나를 다루는 도구. Node판 Workspace와 같은 역할(경로는 프로젝트 안으로만).
const writeQueue = new Map();
export class Workspace {
  constructor(id) { this.id = id; this.local = locals.get(id) ?? null; }
  get isLocal() { return !!this.local; }
  async base() {
    if (this.local) {
      const p = await this.local.queryPermission({ mode: "readwrite" });
      if (p !== "granted") throw Object.assign(new Error(`'${this.id}' PC 폴더를 다시 허용해 주세요.`), { code: "NEED_PERMISSION" });
      return this.local;
    }
    return walkDir(await projectsDir(), [this.id], true);
  }
  async dir(rel = "", create = false) { return walkDir(await this.base(), clean(rel), create); }
  async fileHandle(rel, create = false) {
    const ps = clean(rel);
    if (!ps.length) throw new Error("파일 경로가 비었습니다.");
    const d = await walkDir(await this.base(), ps.slice(0, -1), create);
    return d.getFileHandle(ps.at(-1), { create });
  }
  async exists(rel) { try { await this.fileHandle(rel); return true; } catch (e) { if (e.code === "NEED_PERMISSION") throw e; return false; } }
  async file(rel) { return (await this.fileHandle(rel)).getFile(); }
  async readText(rel) { return (await this.file(rel)).text(); }
  async readBytes(rel) { return new Uint8Array(await (await this.file(rel)).arrayBuffer()); }
  async write(rel, data) {
    // 같은 파일을 동시에 쓰면 브라우저가 잠금 오류를 내므로 한 줄로 세운다
    const key = `${this.id ?? ""}|${rel}`;
    const prev = writeQueue.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      for (let i = 0; ; i++) {
        try {
          const h = await this.fileHandle(rel, true);
          const w = await h.createWritable();
          await w.write(data);
          await w.close();
          return;
        } catch (e) {
          if (i >= 4 || !/NoModificationAllowed|InvalidState|lock/i.test(`${e.name} ${e.message}`)) throw e;
          await new Promise((r) => setTimeout(r, 80 * (i + 1)));
        }
      }
    });
    writeQueue.set(key, run);
    run.finally(() => { if (writeQueue.get(key) === run) writeQueue.delete(key); }).catch(() => {});
    return run;
  }
  async remove(rel) {
    const ps = clean(rel);
    const parent = await walkDir(await this.base(), ps.slice(0, -1));
    await parent.removeEntry(ps.at(-1), { recursive: true });
  }
  // 하위 폴더까지 [{ path, size, lastModified }]
  async list(rel = "", { skip = [".mudex", "node_modules", ".git"], limit = 2000 } = {}) {
    const out = [];
    const walk = async (d, prefix) => {
      for await (const [name, h] of d.entries()) {
        if (out.length >= limit) return;
        if (skip.includes(name)) continue;
        const p = prefix ? `${prefix}/${name}` : name;
        if (h.kind === "directory") { out.push({ path: p + "/", dir: true }); await walk(h, p); }
        else { const f = await h.getFile(); out.push({ path: p, size: f.size, lastModified: f.lastModified }); }
      }
    };
    await walk(await this.dir(rel, true), clean(rel).join("/"));
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}

export const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
};
export const mimeOf = (p) => MIME[String(p).split(".").pop().toLowerCase()] ?? "application/octet-stream";
export const kindOf = (p) => {
  const e = String(p).split(".").pop().toLowerCase();
  if (["mp4", "webm", "mov", "m4v", "mkv"].includes(e)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(e)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(e)) return "image";
  if (["html", "htm"].includes(e)) return "html";
  return "file";
};
