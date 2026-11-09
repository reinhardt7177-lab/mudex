import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../cloud/router.mjs';
import {signSession} from '../cloud/auth.mjs';
test('uploaded active content cannot execute with instructor cookies; ordinary video stays playable',async()=>{
  const secret='session-key',tenant='a'.repeat(64);
  const env={SESSION_SECRET:secret,CONTAINERS:{getByName(){return {async ensureConfigured(){},async fetch(req){return new Response('file',{headers:{'Content-Type':new URL(req.url).pathname.endsWith('.mp4')?'video/mp4':'text/html'}});}};}}};
  const headers={Cookie:'__Host-mudex='+await signSession(tenant,secret)};
  const html=await router.fetch(new Request('https://mudex.example/f/test/unsafe.html',{headers}),env);
  assert.equal(html.headers.get('Content-Disposition'),'attachment');
  assert.match(html.headers.get('Content-Security-Policy'),/sandbox/);
  assert.equal(html.headers.get('X-Content-Type-Options'),'nosniff');
  const video=await router.fetch(new Request('https://mudex.example/f/test/clip.mp4',{headers}),env);
  assert.equal(video.headers.get('Content-Type'),'video/mp4');
  assert.equal(video.headers.get('Content-Disposition'),null);
  assert.match(video.headers.get('Content-Security-Policy'),/sandbox/);
});
