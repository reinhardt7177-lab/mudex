import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpClient} from '../app/higgsfield.mjs';
test('ambiguous session errors cannot replay a possibly completed remote mutation',async()=>{
  const client=new McpClient(await fs.mkdtemp(path.join(os.tmpdir(),'mudex-client-')));
  client.ensureSession=async()=>{};
  let calls=0;client.rpc=async()=>{calls++;if(calls===1)throw new Error('session disconnected after execution');return {structuredContent:{ok:true}};};
  await assert.rejects(client.call('publish_video',{id:'test'}),/session/);
  assert.equal(calls,1);
});
