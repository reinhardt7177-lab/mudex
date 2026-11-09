import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_BYTES = 2 * 1024 ** 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_TYPES = new Map(Object.entries({ "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/ogg": ".ogg", "audio/flac": ".flac" }));

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only ordinary global unicast IPv6; reject mapped IPv4, transition and documentation ranges.
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^200[12]:|^2001:(db8|0*[01][0-9a-f]{0,2}):|^3fff:/i.test(address);
  return false;
}

export async function publicMediaTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("미디어 주소가 올바르지 않습니다."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("인증 정보 없는 공개 https 미디어 주소만 사용할 수 있습니다.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname.includes(".") && !isIP(hostname)) throw new Error("공개 미디어 주소만 사용할 수 있습니다.");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("공개 미디어 주소만 사용할 수 있습니다. 내부·예약 주소는 차단됩니다.");
  return { url, address: addresses[0] };
}

async function mediaResponse(value, signal, redirects = 0) {
  if (signal?.aborted) throw new Error("멈췄습니다.");
  const { url, address } = await publicMediaTarget(value);
  const response = await new Promise((resolve, reject) => {
    // Pin the validated address, including reused requests, to prevent DNS rebinding.
    const req = https.get(url, {
      agent: false, family: address.family, autoSelectFamily: false, signal, headers: { Accept: "video/*, image/*, audio/*" },
      lookup(hostname, options, callback) {
        if (options?.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, resolve);
    req.setTimeout(60_000, () => req.destroy(new Error("미디어 다운로드 응답 시간이 초과되었습니다.")));
    req.on("error", reject);
  });
  if ([301,302,303,307,308].includes(response.statusCode)) {
    response.resume();
    if (redirects >= 3 || !response.headers.location) throw new Error("미디어 주소 이동이 너무 많거나 올바르지 않습니다.");
    return mediaResponse(new URL(response.headers.location, url).toString(), signal, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error(`미디어 다운로드 실패 (${response.statusCode})`); }
  const ext = MEDIA_TYPES.get(String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase());
  if (!ext) { response.resume(); throw new Error("지원하는 영상·사진·음악 파일 응답이 아닙니다."); }
  const length = Number(response.headers["content-length"]);
  if (Number.isFinite(length) && length > MAX_BYTES) { response.destroy(); throw new Error("미디어 크기는 최대 2GB입니다."); }
  return { response, ext };
}

function completedOutputs(status) {
  const state = status?.status ?? status?.state ?? status?.job?.status ?? status?.data?.status;
  if (!/^(completed|succeeded|success|done)$/i.test(String(state))) throw new Error("이미 완료된 작업만 가져올 수 있습니다. (completed job required)");
  const urls = [];
  const walk = (value) => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(url|video_url|image_url|audio_url|download_url|output_url|media_url)$/i.test(key) && typeof item === "string") urls.push(item);
      else if (/^(result|results|output|outputs|data|media|files|images|videos|audios|video|image|audio|generations)$/i.test(key)) walk(item);
    }
  };
  walk(status);
  const unique = [...new Set(urls)];
  if (!unique.length || unique.length > 16) throw new Error("완료된 작업의 미디어 주소를 확인할 수 없습니다. 최대 16개까지 가져올 수 있습니다.");
  return unique;
}

export async function importHiggsfieldMedia(ws, args, ctx) {
  if (!ctx.hf?.loggedIn) throw new Error("힉스필드에 로그인해 주세요.");
  if (!UUID.test(String(args.jobId)) || (args.folderId !== undefined && !UUID.test(String(args.folderId)))) throw new Error("기존 작업(jobId)과 폴더 번호는 유효한 UUID여야 합니다.");
  const status = await ctx.hf.call("job_status", { jobId: args.jobId, ...(args.folderId ? { folder_id: args.folderId } : {}) });
  const urls = completedOutputs(status);
  const deadline = AbortSignal.timeout(10 * 60_000);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, deadline]) : deadline;
  const files = [];
  let bytes = 0;
  try {
    for (const url of urls) {
      const { response, ext } = await mediaResponse(url, signal);
      const name = String(args.name ?? "higgsfield").replace(/[^\w-]/g, "_").slice(0, 60) || "higgsfield";
      const rel = `imported/${name}_${crypto.randomBytes(8).toString("hex")}${ext}`;
      const file = ws.outPath(rel);
      const partial = `${file}.part`;
      const root = fs.realpathSync(ws.dir);
      const parent = fs.realpathSync(path.dirname(file));
      if (parent !== root && !parent.startsWith(root + path.sep)) { response.destroy(); throw new Error("작업 폴더 밖 경로는 쓸 수 없습니다."); }
      const limiter = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_BYTES ? new Error("가져오는 미디어의 전체 크기는 최대 2GB입니다.") : null, chunk);
      } });
      const fd = fs.openSync(partial, "wx");
      try {
        await pipeline(response, limiter, fs.createWriteStream(partial, { fd }), { signal });
        fs.renameSync(partial, file);
        files.push(rel);
      } catch (error) {
        try { fs.unlinkSync(partial); } catch {}
        throw error;
      }
    }
  } catch (error) {
    for (const rel of files) { try { fs.unlinkSync(ws.p(rel)); } catch {} }
    throw error;
  }
  return { files, jobId: args.jobId, bytes, note: "기존 미디어를 작업 폴더로 가져왔습니다. 생성 요청은 보내지 않았습니다." };
}
