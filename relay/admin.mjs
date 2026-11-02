// 강사용 코드 관리 도구. 관리 비밀값은 .secrets/admin_secret.txt에서 읽고 화면에 찍지 않는다.
//   node relay/admin.mjs list
//   node relay/admin.mjs create 20 3 2026-11-28 "광주 2기"     (개수, 1인 한도 달러, 만료일, 이름)
//   node relay/admin.mjs disable MDX-XXXX-XXXX

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELAY = process.env.MUDEX_RELAY ?? "https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay";
const secret = fs.readFileSync(path.join(ROOT, ".secrets", "admin_secret.txt"), "utf8").trim();
const [cmd, ...rest] = process.argv.slice(2);

async function call(method, p, body) {
  const r = await fetch(RELAY + p, {
    method,
    headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) { console.error(r.status, j); process.exit(1); }
  return j;
}

if (cmd === "create") {
  const [count = "1", budget = "3", until, label = "연수생"] = rest;
  // 만료일은 한국 시각 그날 밤 23:59
  const expires_at = until ? new Date(`${until}T23:59:59+09:00`).toISOString() : undefined;
  const j = await call("POST", "/admin/codes", { count: Number(count), budget_usd: Number(budget), expires_at, label });
  for (const c of j.codes) console.log(`${c.label}\t${c.code}\t${c.budget_usd}달러\t~${c.expires_at}`);
} else if (cmd === "disable") {
  await call("POST", "/admin/codes/disable", { code: rest[0] });
  console.log("껐습니다:", rest[0]);
} else {
  const j = await call("GET", "/admin/codes");
  for (const c of j.codes) console.log(`${c.label}\t${c.code}\t${c.spent_usd}/${c.budget_usd}달러\t${c.disabled ? "꺼짐" : ""}\t~${new Date(c.expires_at).toISOString().slice(0, 10)}`);
}
