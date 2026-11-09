import { signSession, readSession, tenantId, storageToken, storageKey } from './auth.mjs';
const RELAY='https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay';
const cookieName='__Host-mudex';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
const sessionCookie=value=>`${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800`;

async function storage(request,env,url) {
  const match=url.pathname.match(/^\/__storage\/([a-f0-9]{64})\/(.*)$/);
  if (!match || request.headers.get('Authorization')!==`Bearer ${await storageToken(match[1],env.SESSION_SECRET)}`) return json({error:'Unauthorized'},401);
  const [,tenant,raw]=match;
  if (url.searchParams.has('list') && request.method==='GET') {
    const keys=[];let cursor;
    do {
      const result=await env.FILES.list({prefix:`${tenant}/`,cursor});
      for(const object of result.objects) keys.push(object.key.slice(tenant.length+1));
      cursor=result.truncated ? result.cursor : undefined;
    } while(cursor);
    return json(keys);
  }
  let key;
  try {key=storageKey(tenant,decodeURIComponent(raw));} catch {return json({error:'Invalid path'},400);}
  const uploadId=url.searchParams.get('uploadId');
  if (request.method==='POST' && url.searchParams.get('multipart')==='create') {
    const upload=await env.FILES.createMultipartUpload(key);
    return json({uploadId:upload.uploadId});
  }
  if (uploadId) {
    const upload=env.FILES.resumeMultipartUpload(key,uploadId);
    if(request.method==='PUT') return json(await upload.uploadPart(Number(url.searchParams.get('partNumber')),request.body));
    if(request.method==='POST') {await upload.complete((await request.json()).parts);return json({ok:true});}
    if(request.method==='DELETE') {await upload.abort();return json({ok:true});}
  }
  if(request.method==='PUT') {await env.FILES.put(key,request.body);return json({ok:true});}
  if(request.method==='DELETE') {await env.FILES.delete(key);return json({ok:true});}
  if(request.method==='GET') {
    const object=await env.FILES.get(key);
    return object ? new Response(object.body,{headers:{'Cache-Control':'no-store'}}) : new Response('Not found',{status:404});
  }
  return json({error:'Method not allowed'},405);
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (!env.SESSION_SECRET) return json({error:'서비스를 준비하고 있습니다.'},503);
    try {
      if (url.pathname.startsWith('/__storage/')) return await storage(request,env,url);
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin')!==url.origin) return json({error:'요청 출처를 확인하지 못했습니다.'},403);
      if(url.pathname==='/cloud/login' && request.method==='POST') {
        if(Number(request.headers.get('Content-Length'))>2048) return json({error:'요청이 너무 큽니다.'},413);
        if(!await env.LOGIN_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') ?? 'unknown'}).then(x=>x.success)) return json({error:'잠시 후 다시 시도해 주세요.'},429);
        const {code:input}=await request.json();
        const code=String(input??'').trim().toUpperCase();
        if(!/^MDX-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({error:'강사 코드를 확인해 주세요.'},400);
        const response=await fetch(`${RELAY}/status`,{headers:{Authorization:`Bearer ${code}`},signal:AbortSignal.timeout(15000)});
        const result=await response.json();
        if(!response.ok) return json({error:result.error?.message ?? '코드를 확인하지 못했습니다.'},400);
        const tenant=await tenantId(code,env.SESSION_SECRET);
        await env.CONTAINERS.getByName(tenant).configure({tenant,origin:url.origin,code});
        return json({ok:true},200,{'Set-Cookie':sessionCookie(await signSession(tenant,env.SESSION_SECRET))});
      }
      const rawCookie=(request.headers.get('Cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      const tenant=await readSession(rawCookie,env.SESSION_SECRET);
      if(url.pathname==='/cloud/logout' && request.method==='POST') {
        if(tenant && !await env.CONTAINERS.getByName(tenant).hibernate()) return json({error:'진행 중인 영상 작업을 마친 뒤 나가 주세요.'},409);
        return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`});
      }
      if(url.pathname.startsWith('/__')) return json({error:'Not found'},404);
      if (/^\/(api\/|f\/|thumb\/|practice\/|oauth\/)/.test(url.pathname)) {
        if(!tenant) return json({error:'강사 코드로 입장해 주세요.'},401);
        const headers=new Headers(request.headers);headers.delete('Cookie');headers.delete('Authorization');headers.set('X-Mudex-Tenant',tenant);
        const app=env.CONTAINERS.getByName(tenant);
        await app.ensureConfigured(tenant,url.origin);
        return await app.fetch(new Request(request,{headers}));
      }
      if (!tenant && (url.pathname==='/' || url.pathname==='/index.html')) {
        const response=await env.ASSETS.fetch(new Request(`${url.origin}/cloud-login.html`));
        return new Response(response.body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
      return env.ASSETS.fetch(request);
    } catch(e) {
      console.error('Mudex request failed',url.pathname,e.message);
      return json({error:'클라우드 작업실을 준비하지 못했습니다. 잠시 후 새로고침해 주세요.'},503);
    }
  },
};
