import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fork} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('cloud server saves chunked uploads and practice connectors across fresh container filesystems', {timeout:20000}, async () => {
  const objects=new Map();
  const store=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://store'),key=decodeURIComponent(url.pathname.slice(7));
    if(req.headers.authorization!=='Bearer test-token'){res.writeHead(401);res.end();return;}
    if(url.searchParams.has('list')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([...objects.keys()]));return;}
    if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);objects.set(key,Buffer.concat(chunks));res.end('ok');return;}
    if(req.method==='DELETE'){objects.delete(key);res.end('ok');return;}
    if(objects.has(key)){res.end(objects.get(key));return;}
    res.writeHead(404);res.end();
  });
  await new Promise(r=>store.listen(0,'127.0.0.1',r));
  let child,origin;
  async function start(){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mudex-server-'));
    const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
    origin=`http://127.0.0.1:${port}`;
    child=fork(new URL('../app/server.mjs',import.meta.url),['--no-open'],{silent:true,env:{...process.env,PORT:String(port),MUDEX_PUBLIC_URL:origin,MUDEX_DATA_ROOT:dir,MUDEX_STORE_URL:`http://127.0.0.1:${store.address().port}/store/`,MUDEX_STORE_TOKEN:'test-token',MUDEX_CODE:''}});
    await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',c=>{out+=c;if(out.includes('준비됨'))resolve();});child.once('exit',code=>reject(new Error(`Server exited ${code}`)));child.stderr.on('data',c=>{out+=c;});setTimeout(()=>reject(new Error(out||'startup timeout')),5000).unref();});
  }
  async function stop(){if(child){const p=once(child,'exit');child.kill();await p;child=null;}}
  const call=async(method,url,body)=>{const r=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
  try {
    await start();
    assert.equal((await call('POST','/api/code',{code:'MDX-AAAA-BBBB'})).status,400);
    const created=await call('POST','/api/jobs',{name:'학교 영상'});assert.equal(created.status,200);
    const job=encodeURIComponent(created.body.id),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCZoAAAAASUVORK5CYII=','base64');
    let r=await fetch(`${origin}/api/jobs/${job}/upload?name=frame.png&offset=0&final=false`,{method:'PUT',body:png.subarray(0,30)});assert.equal(r.status,200);
    assert.equal(objects.has('jobs/학교 영상/frame.png'),false);
    r=await fetch(`${origin}/api/jobs/${job}/upload?name=frame.png&offset=30&final=true`,{method:'PUT',body:png.subarray(30)});assert.equal(r.status,200);
    assert.deepEqual(objects.get('jobs/학교 영상/frame.png'),png);
    const added=await call('POST','/api/connectors',{name:'연습',url:'https://mcp.higgsfield.ai/mcp',practice:true});
    const connected=await call('POST',`/api/connectors/${added.body.id}/connect`);assert.ok(connected.body.url.startsWith(origin+'/practice/authorize'));
    await fetch(origin+`/practice/approve?c=${added.body.id}`,{method:'POST'});
    assert.equal((await call('GET','/api/state')).body.cloud,true);
    await stop();await start();
    const state=await call('GET','/api/state');assert.equal(state.body.jobs[0].id,'학교 영상');
    assert.deepEqual(Buffer.from(await (await fetch(`${origin}/f/${job}/frame.png`)).arrayBuffer()),png);
    const connectors=await call('GET','/api/connectors');assert.equal(connectors.body.connectors[0].practice_connected,true);
    const blocked=await call('POST',`/api/connectors/${added.body.id}/call`,{name:'generate_video'});assert.notEqual(blocked.status,200);
  } finally {await stop();store.closeAllConnections();await new Promise(r=>store.close(r));}
});
