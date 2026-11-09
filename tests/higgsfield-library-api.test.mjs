import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {Higgsfield} from '../app/higgsfield.mjs';

test('library HTTP flow imports catalog bytes to the chosen job and rejects stale jobs and invented selections',{timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mudex-library-api-'));fs.mkdirSync(path.join(root,'data'));
  fs.writeFileSync(path.join(root,'data','hf_token.json'),JSON.stringify({access_token:'fixture'}));
  const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  process.env.MUDEX_DATA_ROOT=root;process.env.PORT=String(port);process.env.MUDEX_NO_OPEN='1';delete process.env.MUDEX_PUBLIC_URL;
  const calls=[];
  t.mock.method(Higgsfield.prototype,'call',async(name,args)=>{
    calls.push(name);
    if(name==='balance')return {credits:10};
    assert.equal(name,'show_generations');assert.equal(args.type,'video');
    return {items:[{id:'video-1',type:'video',status:'completed',params:{prompt:'테스트 영상'},results:{rawUrl:'https://cdn.example/clip.mp4'}}],next_cursor:null};
  });
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'get',(url,options,callback)=>{
    const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req;
    queueMicrotask(()=>{const response=Readable.from([Buffer.from('fixture-video-bytes')]);response.statusCode=200;response.headers={'content-type':'video/mp4'};callback(response);});return req;
  });
  const {server}=await import('../app/server.mjs');
  if(!server.listening)await new Promise(r=>server.once('listening',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${port}`;
  const call=async(method,route,body)=>{const r=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  const created=await call('POST','/api/jobs',{name:'가져오기 대상'}),id=encodeURIComponent(created.body.id);
  const job=await call('GET',`/api/jobs/${id}`),gallery=await call('GET','/api/hf/library?source=generations');assert.equal(gallery.status,200);
  const key=gallery.body.items[0].key;
  assert.equal((await call('POST',`/api/jobs/${id}/hf-import`,{key,job_uid:'other'})).status,409);
  assert.equal((await call('POST',`/api/jobs/${id}/hf-import`,{key:'invented',job_uid:job.body.uid})).status,400);
  const result=await call('POST',`/api/jobs/${id}/hf-import`,{key,job_uid:job.body.uid});assert.equal(result.status,200);
  assert.equal(await (await fetch(base+`/f/${id}/${result.body.files[0]}`)).text(),'fixture-video-bytes');
  assert.equal((await call('POST','/api/jobs/missing/hf-import',{key,job_uid:job.body.uid})).status,404);
  assert.equal(calls.includes('generate_video'),false);
  assert.equal((await call('POST','/api/hf/logout')).status,200);
  assert.equal((await call('GET','/api/hf/library')).status,400);
});
