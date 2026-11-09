import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpClient,Higgsfield} from '../app/higgsfield.mjs';
test('ambiguous session errors cannot replay a possibly completed remote mutation',async()=>{
  const client=new McpClient(await fs.mkdtemp(path.join(os.tmpdir(),'mudex-client-')));
  client.ensureSession=async()=>{};
  let calls=0;client.rpc=async()=>{calls++;if(calls===1)throw new Error('session disconnected after execution');return {structuredContent:{ok:true}};};
  await assert.rejects(client.call('publish_video',{id:'test'}),/session/);
  assert.equal(calls,1);
});

test('provider session rejection is diagnosed without falsely accepting connection or replaying the call',async()=>{
  const client=new Higgsfield(await fs.mkdtemp(path.join(os.tmpdir(),'mudex-session-')));
  client.saveToken({access_token:'test'});client.ensureSession=async()=>{};
  let calls=0;client.rpc=async()=>{calls++;return {isError:true,content:[{type:'text',text:JSON.stringify({error:'Your Higgsfield session has expired or is no longer valid. Please re-authorize.',request_id:'test-request'})}]};};
  await assert.rejects(client.call('list_workspaces'),e=>e.code==='higgsfield_session_rejected'&&/힉스필드/.test(e.message));
  assert.equal(calls,1);assert.equal(client.authIssue?.code,'higgsfield_session_rejected');assert.equal(client.authIssue?.request_id,'test-request');
  assert.equal(client.loggedIn,true,'OAuth token remains available: upstream rejection is not proof it expired');
  client.rpc=async()=>({structuredContent:{credits:10}});await client.verifyConnection();assert.equal(client.authIssue,null);
});

test('Higgsfield OAuth success requires a real read-only service call',async()=>{
  const client=new Higgsfield(await fs.mkdtemp(path.join(os.tmpdir(),'mudex-verify-')));
  let name;client.call=async n=>{name=n;throw new Error('service rejected');};
  await assert.rejects(client.verifyConnection(),/service rejected/);assert.equal(name,'balance');
});
test('user-authored prompt text in a successful response cannot invalidate authentication',async()=>{
  const client=new Higgsfield(await fs.mkdtemp(path.join(os.tmpdir(),'mudex-session-text-')));client.ensureSession=async()=>{};
  const result={items:[{params:{prompt:'Your Higgsfield session has expired'},status:'completed'}]};client.rpc=async()=>({structuredContent:result});
  assert.deepEqual(await client.call('show_generations'),result);assert.equal(client.authIssue,null);
});
