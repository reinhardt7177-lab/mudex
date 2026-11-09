const encoder = new TextEncoder();
async function signature(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export const tenantId = (code, secret) => signature(`tenant:${code}`, secret);
export const storageToken = (tenant, secret) => signature(`storage:${tenant}`, secret);
export async function signSession(id, secret, expires = Math.floor(Date.now()/1000)+7*86400) {
  const body = `${id}.${expires}`;
  return `${body}.${await signature(body, secret)}`;
}
export async function readSession(value, secret, now = Math.floor(Date.now()/1000)) {
  if (!value || !/^[a-f0-9]{64}\.\d{1,12}\.[a-f0-9]{64}$/.test(value)) return null;
  const [id, expires, sig] = value.split('.');
  if (Number(expires) <= now) return null;
  return await signature(`${id}.${expires}`, secret) === sig ? id : null;
}
export function storageKey(id, relative) {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^(data|jobs)\/.+/.test(relative) || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(x=>!x || x==='.' || x==='..')) throw new Error('Invalid storage path');
  return `${id}/${relative}`;
}
