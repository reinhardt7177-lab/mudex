const encoder=new TextEncoder();
async function key(secret) {
  const bytes=await crypto.subtle.digest('SHA-256',encoder.encode('mudex-instructor-session-v1:'+secret));
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealInstructorSession(credential,secret,expires=Math.floor(Date.now()/1000)+3600) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),encoder.encode(JSON.stringify({credential,expires}))));
  return btoa(String.fromCharCode(...iv,...encrypted)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function readInstructorSession(value,secret,now=Math.floor(Date.now()/1000)) {
  if(!value || value.length>4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await key(secret),bytes.slice(12));
    const session=JSON.parse(new TextDecoder().decode(plain));
    return Number.isFinite(session.expires) && session.expires>now && typeof session.credential==='string' && session.credential.length<=256 ? session.credential : null;
  } catch { return null; }
}
