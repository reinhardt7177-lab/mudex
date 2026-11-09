import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../cloud/router.mjs';
import {signSession,storageToken,readSession} from '../cloud/auth.mjs';
test('gateway rejects anonymous, forged and cross-origin requests; strips browser credentials',async()=>{
  let calls=0;
  const env={SESSION_SECRET:'test-secret',CONTAINERS:{getByName(id){calls++;return {async ensureConfigured(tenant){assert.equal(tenant,id);},async fetch(req){assert.equal(id,'a'.repeat(64));assert.equal(req.headers.get('X-Mudex-Tenant'),id);assert.equal(req.headers.get('Cookie'),null);assert.equal(req.headers.get('Authorization'),null);return Response.json({ok:true});}};}}};
  const request=(url,options={})=>router.fetch(new Request('https://mudex.example'+url,options),env);
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/state',{headers:{Cookie:'__Host-mudex=forged'}})).status,401);
  assert.equal(calls,0);
  const cookie='__Host-mudex='+await signSession('a'.repeat(64),env.SESSION_SECRET);
  assert.equal((await request('/api/jobs',{method:'POST',headers:{Cookie:cookie,Origin:'https://attacker.example'},body:'{}'})).status,403);
  assert.equal((await request('/api/state',{headers:{Cookie:cookie,Authorization:'Bearer user-supplied'}})).status,200);
  assert.equal(calls,1);
  assert.equal((await request('/__cloud/flush',{method:'POST',headers:{Cookie:cookie,Origin:'https://mudex.example'}})).status,404);
});
test('valid instructor login creates a secure session for the same stable isolated workspace',async t=>{
  let selected,configuration;
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.ok(url.endsWith('/status'));assert.equal(init.headers.Authorization,'Bearer MDX-AAAA-BBBB');return Response.json({remaining_usd:3});});
  const env={SESSION_SECRET:'test-secret',LOGIN_LIMIT:{async limit(){return {success:true};}},CONTAINERS:{getByName(id){selected=id;return {async configure(config){configuration=config;}};}}};
  const response=await router.fetch(new Request('https://mudex.example/cloud/login',{method:'POST',headers:{Origin:'https://mudex.example','Content-Type':'application/json'},body:JSON.stringify({code:'mdx-aaaa-bbbb'})}),env);
  assert.equal(response.status,200);assert.equal(configuration.code,'MDX-AAAA-BBBB');
  const cookie=response.headers.get('Set-Cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Lax/);
  const value=cookie.split(';')[0].slice('__Host-mudex='.length);
  assert.equal(await readSession(value,env.SESSION_SECRET),selected);
  assert.equal(configuration.tenant,selected);assert.equal(configuration.origin,'https://mudex.example');
});
test('storage tokens grant access to only their own tenant prefix',async()=>{
  const a='a'.repeat(64),b='b'.repeat(64);let seen;
  const env={SESSION_SECRET:'test-secret',FILES:{async put(key){seen=key;}}};
  const headers={Authorization:'Bearer '+await storageToken(a,env.SESSION_SECRET)};
  let r=await router.fetch(new Request(`https://mudex.example/__storage/${b}/data/settings.json`,{method:'PUT',headers,body:'secret'}),env);
  assert.equal(r.status,401);assert.equal(seen,undefined);
  r=await router.fetch(new Request(`https://mudex.example/__storage/${a}/data/settings.json`,{method:'PUT',headers,body:'secret'}),env);
  assert.equal(r.status,200);assert.equal(seen,`${a}/data/settings.json`);
  r=await router.fetch(new Request(`https://mudex.example/__storage/${a}/data/%2e%2e%2fserver.mjs`,{method:'PUT',headers,body:'secret'}),env);
  assert.equal(r.status,400);
});
