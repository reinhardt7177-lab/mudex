import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../cloud/router.mjs';
import {sealInstructorSession,readInstructorSession} from '../cloud/instructor-auth.mjs';

test('instructor session encrypts credential and rejects tampering, wrong key and expiry',async()=>{
  const token=await sealInstructorSession('test-admin-secret','session-key',1000);
  assert.ok(!token.includes('test-admin-secret'));
  assert.equal(await readInstructorSession(token,'session-key',999),'test-admin-secret');
  assert.equal(await readInstructorSession(token,'session-key',1001),null);
  assert.equal(await readInstructorSession(token+'x','session-key',999),null);
  assert.equal(await readInstructorSession(token,'wrong-key',999),null);
});
test('instructor login accepts admin credential separately from MDX learner code and protects code management',async t=>{
  const env={SESSION_SECRET:'session-key',LOGIN_LIMIT:{async limit(){return {success:true};}}};
  const request=(url,options={})=>router.fetch(new Request('https://mudex.example'+url,options),env);
  const options=(code)=>({method:'POST',headers:{Origin:'https://mudex.example','Content-Type':'application/json'},body:JSON.stringify({code})});
  let writes=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.ok(url.endsWith('/admin/codes'));
    if(init.headers['x-admin-secret']!=='test-admin-secret') return Response.json({error:{message:'인증 실패'}},{status:401});
    if(init.method==='POST'){writes++;return Response.json({codes:[{code:'MDX-AAAA-BBBB'}]});}
    return Response.json({codes:[]});
  });
  assert.equal((await request('/cloud/instructor/codes')).status,401);
  assert.equal((await request('/cloud/instructor/login',options('wrong'))).status,401);
  const login=await request('/cloud/instructor/login',options('test-admin-secret'));
  assert.equal(login.status,200);
  const cookie=login.headers.get('Set-Cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);assert.ok(!cookie.includes('test-admin-secret'));
  const headers={Cookie:cookie.split(';')[0],Origin:'https://mudex.example','Content-Type':'application/json'};
  assert.equal((await request('/cloud/instructor/codes',{headers})).status,200);
  assert.equal((await request('/cloud/instructor/codes',{method:'POST',headers,body:JSON.stringify({count:1,budget_usd:-1,label:'학급',expires_at:'2026-11-28'})})).status,400);
  assert.equal(writes,0);
  assert.equal((await request('/cloud/instructor/codes',{method:'POST',headers,body:JSON.stringify({count:1,budget_usd:3,label:'학급',expires_at:'2026-11-28T14:59:59Z'})})).status,200);
  assert.equal(writes,1);
  assert.equal((await request('/cloud/instructor/codes',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:'{}'})).status,403);
});
