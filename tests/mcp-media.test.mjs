import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable,PassThrough} from 'node:stream';
import {Workspace,TOOLS} from '../app/ffmpeg_tools.mjs';
import {CloudStorage} from '../app/cloud-storage.mjs';

const JOB='12345678-1234-4234-8234-123456789abc';
async function setup(t,{status='completed',url='https://media.example/clip.mp4',headers={},body='video'}={}) {
  const mod=await import('../app/remote-media.mjs').catch(()=>({}));
  assert.equal(typeof mod.importHiggsfieldMedia,'function','existing-media importer must exist');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mudex-mcp-media-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ws=new Workspace(dir);
  const calls=[];let requests=0;
  const hf={loggedIn:true,async call(name,args){calls.push({name,args});return {status,result:{video_url:url}};}};
  t.mock.method(dns,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
  t.mock.method(https,'get',(target,options,callback)=>{
    requests++;
    assert.equal(target.protocol,'https:');assert.equal(options.headers?.Authorization,undefined);
    options.lookup(target.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
    options.lookup(target.hostname,{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
    const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=()=>req;
    queueMicrotask(()=>{const response=Readable.from([Buffer.from(body)]);response.statusCode=200;response.headers={'content-type':'video/mp4',...headers};callback(response);});
    return req;
  });
  return {ws,hf,calls,requests:()=>requests,run:args=>mod.importHiggsfieldMedia(ws,args,{hf}),mod};
}

test('imports a completed authorized existing job into editable local media with folder context',async t=>{
  const s=await setup(t);
  const result=await s.run({jobId:JOB,folderId:JOB,name:'../../unsafe'});
  assert.deepEqual(s.calls,[{name:'job_status',args:{jobId:JOB,folder_id:JOB}}]);
  assert.equal(result.files.length,1);
  assert.match(result.files[0],/^imported\/[\w-]+\.mp4$/);
  assert.equal(fs.readFileSync(s.ws.p(result.files[0]),'utf8'),'video');
  assert.equal(s.requests(),1);
});

test('pending jobs, unsigned users and invalid ids do not start downloads or generations',async t=>{
  const s=await setup(t,{status:'processing'});
  await assert.rejects(s.run({jobId:JOB}),/완료|completed/i);
  await assert.rejects(s.run({jobId:'../../file'}),/작업|job/i);
  s.hf.loggedIn=false;
  await assert.rejects(s.run({jobId:JOB}),/로그인|auth/i);
  assert.equal(s.requests(),0);
  assert.ok(s.calls.every(c=>c.name==='job_status'));
});
test('normalized Higgsfield rawUrl results import the video without downloading its thumbnail',async t=>{
  const s=await setup(t);s.hf.call=async()=>({status:'completed',results:{rawUrl:'https://media.example/video.mp4',thumbnailUrl:'https://media.example/thumb.jpg'}});
  const result=await s.run({jobId:JOB});assert.equal(result.files.length,1);assert.equal(s.requests(),1);
});

test('download rejects local URLs and DNS addresses, unsupported media and files over 2GB',async t=>{
  const s=await setup(t,{url:'https://127.0.0.1/video.mp4'});
  await assert.rejects(s.run({jobId:JOB}),/주소|public|공개/i);
  assert.equal(s.requests(),0);
  for (const address of ['127.0.0.1','10.0.0.2','169.254.169.254','192.168.1.1','0.0.0.0','::1','::ffff:127.0.0.1','2001:db8::1']) {
    t.mock.method(dns,'lookup',async()=>[{address,family:address.includes(':')?6:4}]);
    await assert.rejects(s.mod.publicMediaTarget('https://media.example/video.mp4'),/주소|public|공개/i,address);
  }
  await assert.rejects(s.mod.publicMediaTarget('http://media.example/video.mp4'),/https|주소/i);
  await assert.rejects(s.mod.publicMediaTarget('https://user:password@media.example/video.mp4'),/주소|인증/i);
});

test('public IPv6 literals retain their validated family without a second DNS lookup',async t=>{
  const s=await setup(t);
  t.mock.method(dns,'lookup',async()=>{throw new Error('literal must not be resolved');});
  const target=await s.mod.publicMediaTarget('https://[2606:4700:4700::1111]/video.mp4');
  assert.equal(target.url.hostname,'[2606:4700:4700::1111]');
  assert.deepEqual(target.address,{address:'2606:4700:4700::1111',family:6});
});

test('oversized and non-media responses leave no completed or partial local files',async t=>{
  const s=await setup(t,{headers:{'content-length':String(2*1024**3+1)}});
  await assert.rejects(s.run({jobId:JOB}),/2GB|크기/i);
  assert.deepEqual(fs.readdirSync(s.ws.dir).filter(x=>x!=='out'),[]);
});

test('import tool is exposed through the same agent descriptor set',async()=>{
  const mod=await import('../app/mcp-tools.mjs');
  const tool=mod.MCP_TOOLS.find(t=>t.name==='import_higgsfield_media');
  assert.ok(tool);
  assert.deepEqual(tool.parameters.required,['jobId']);
});

test('redirects are revalidated and cannot reach private hosts',async t=>{
  const s=await setup(t);
  let count=0;
  t.mock.method(https,'get',(target,options,callback)=>{
    count++;
    const req=new EventEmitter();req.setTimeout=()=>req;
    queueMicrotask(()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'https://169.254.169.254/latest/meta-data'};callback(res);});
    return req;
  });
  await assert.rejects(s.run({jobId:JOB}),/주소|공개/i);
  assert.equal(count,1);
});

test('non-media and interrupted responses never leave partial files',async t=>{
  const s=await setup(t,{headers:{'content-type':'text/html'}});
  await assert.rejects(s.run({jobId:JOB}),/파일|media/i);
  t.mock.method(https,'get',(target,options,callback)=>{
    const req=new EventEmitter();req.setTimeout=()=>req;
    queueMicrotask(()=>{const res=Readable.from((async function*(){yield Buffer.from('partial');throw new Error('interrupted');})());res.statusCode=200;res.headers={'content-type':'video/mp4'};callback(res);});
    return req;
  });
  await assert.rejects(s.run({jobId:JOB}),/interrupted/);
  assert.deepEqual(fs.readdirSync(path.join(s.ws.dir,'imported')),[]);
});

test('active downloads stay invisible to media listing and cloud sync until atomic publication',async t=>{
  const s=await setup(t);
  const jobDir=path.join(s.ws.dir,'jobs','job1');
  const ws=new Workspace(jobDir);
  const source=new PassThrough();source.statusCode=200;source.headers={'content-type':'image/png'};
  t.mock.method(https,'get',(target,options,callback)=>{
    const req=new EventEmitter();req.setTimeout=()=>req;
    queueMicrotask(()=>callback(source));return req;
  });
  const pending=s.mod.importHiggsfieldMedia(ws,{jobId:JOB},{hf:s.hf});
  source.write(Buffer.from('partial'));
  const importDir=path.join(jobDir,'imported');
  for(let i=0;i<30 && (!fs.existsSync(importDir) || !fs.readdirSync(importDir).length);i++) await new Promise(resolve=>setImmediate(resolve));
  let before;
  try {
    assert.ok(fs.existsSync(importDir),'stream must have reached local storage');
    before=fs.readdirSync(importDir);
    assert.equal(before.length,1);
    assert.match(before[0],/\.part$/);
    const listing=await TOOLS.find(tool=>tool.name==='list_clips').run(ws);
    assert.deepEqual(listing,{videos:[],music:[],images:[]});
    const uploaded=[];
    const storage=new CloudStorage(s.ws.dir,'https://storage.example/','test',async(url,opts)=>{
      if(opts.method==='PUT'){for await (const chunk of opts.body){}uploaded.push(url);}
      return new Response('{}');
    });
    await storage.sync();assert.deepEqual(uploaded,[]);
    source.end(Buffer.from('complete'));
    const result=await pending;
    assert.match(result.files[0],/\.png$/);
    assert.deepEqual(fs.readdirSync(importDir),[path.basename(result.files[0])]);
    assert.equal(fs.readFileSync(ws.p(result.files[0]),'utf8'),'partialcomplete');
    assert.deepEqual((await TOOLS.find(tool=>tool.name==='list_clips').run(ws)).images,[result.files[0]]);
    await storage.sync();assert.equal(uploaded.length,1);assert.match(uploaded[0],/\.png$/);
  } finally {
    source.end();await pending.catch(()=>{});
  }
});
