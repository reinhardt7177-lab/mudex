import {sealInstructorSession,readInstructorSession} from './instructor-auth.mjs';
const RELAY='https://nqspbiprvsbjluqpjvpo.supabase.co/functions/v1/mudex-relay';
const COOKIE='__Host-mudex-instructor';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
const cookie=(value,maxAge=3600)=>`${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
async function relay(credential,method,path,body) {
  const response=await fetch(RELAY+path,{method,headers:{'x-admin-secret':credential,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  if(response.status===401 || response.status===403) return json({error:'강사 입장 코드가 맞지 않습니다.'},401);
  if(!response.ok) return json({error:'코드 관리 서버에서 요청을 처리하지 못했습니다.'},502);
  return json(await response.json());
}
export async function instructor(request,env,url) {
  if(Number(request.headers.get('Content-Length'))>4096) return json({error:'요청이 너무 큽니다.'},413);
  const value=(request.headers.get('Cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(url.pathname==='/cloud/instructor/login' && request.method==='POST') {
    if(!await env.LOGIN_LIMIT.limit({key:'instructor:'+(request.headers.get('CF-Connecting-IP')??'unknown')}).then(x=>x.success)) return json({error:'잠시 후 다시 시도해 주세요.'},429);
    const {code}=await request.json();
    if(typeof code!=='string' || !code.length || code.length>256) return json({error:'강사 입장 코드를 넣어 주세요.'},400);
    const checked=await relay(code,'GET','/admin/codes');
    if(!checked.ok) return checked;
    return json({ok:true},200,{'Set-Cookie':cookie(await sealInstructorSession(code,env.SESSION_SECRET))});
  }
  if(url.pathname==='/cloud/instructor/logout' && request.method==='POST') return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  if(url.pathname==='/instructor/login') return env.ASSETS.fetch(new Request(url.origin+'/instructor-login.html'));
  const credential=await readInstructorSession(value,env.SESSION_SECRET);
  if(url.pathname==='/instructor' || url.pathname==='/instructor.html') {
    if(!credential) return new Response(null,{status:303,headers:{Location:'/instructor/login','Cache-Control':'no-store'}});
    const response=await env.ASSETS.fetch(new Request(url.origin+'/instructor.html'));
    return new Response(response.body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
  }
  if(!credential) return json({error:'강사로 다시 입장해 주세요.'},401);
  if(url.pathname==='/cloud/instructor/codes') {
    if(request.method==='GET') return relay(credential,'GET','/admin/codes');
    if(request.method==='POST') {
      const body=await request.json();
      const {count,budget_usd,expires_at}=body;
      const label=typeof body.label==='string'?body.label.trim().slice(0,40):'';
      if(!Number.isInteger(count) || count<1 || count>100 || !Number.isFinite(budget_usd) || budget_usd<0.01 || budget_usd>100 || !label || !Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at)<=Date.now()) return json({error:'개수 1~100개, 1인 한도 0.01~100달러, 이름과 만료일을 확인해 주세요.'},400);
      return relay(credential,'POST','/admin/codes',{count,budget_usd,label,expires_at:new Date(expires_at).toISOString()});
    }
  }
  if(url.pathname==='/cloud/instructor/disable' && request.method==='POST') {
    const {code}=await request.json();
    if(typeof code!=='string' || !/^MDX-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return json({error:'연수생 코드를 확인해 주세요.'},400);
    return relay(credential,'POST','/admin/codes/disable',{code});
  }
  return json({error:'없는 강사 메뉴입니다.'},404);
}
