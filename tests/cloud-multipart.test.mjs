import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CloudStorage} from '../app/cloud-storage.mjs';
test('large files use ordered multipart uploads and are not uploaded again unchanged',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mudex-multipart-'));
  await fs.mkdir(path.join(dir,'jobs','a'),{recursive:true});
  const f=await fs.open(path.join(dir,'jobs','a','video.mp4'),'w');await f.truncate(33*1024*1024);await f.close();
  const sizes=[];let completed=0;
  const request=async(url,init={})=>{
    const u=new URL(url);
    if(u.searchParams.has('list'))return Response.json([]);
    if(u.searchParams.get('multipart')==='create')return Response.json({uploadId:'test-upload'});
    if(init.method==='PUT'){const bytes=await new Response(init.body).arrayBuffer();sizes.push(bytes.byteLength);return Response.json({partNumber:Number(u.searchParams.get('partNumber')),etag:'etag-'+sizes.length});}
    if(init.method==='POST'){assert.deepEqual(JSON.parse(init.body).parts.map(x=>x.partNumber),[1,2,3]);completed++;return Response.json({ok:true});}
    throw new Error('Unexpected request');
  };
  const store=new CloudStorage(dir,'https://example.com/store/','token',request);
  await store.restore();await store.sync();await store.sync();
  assert.deepEqual(sizes,[16*1024*1024,16*1024*1024,1024*1024]);assert.equal(completed,1);
});
