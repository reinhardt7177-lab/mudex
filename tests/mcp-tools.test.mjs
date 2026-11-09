import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Connectors} from '../app/connectors.mjs';

async function bridge(t) {
  const module=await import('../app/mcp-tools.mjs').catch(()=>({}));
  assert.ok(Array.isArray(module.MCP_TOOLS),'agent MCP tools must be exported');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mudex-mcp-tools-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const hf={loggedIn:true,async listTools(){return [{name:'list_assets',description:'existing assets',inputSchema:{type:'object'}},{name:'generate_video',inputSchema:{type:'object'}}];},async call(name,args){calls.push({name,args});return {name,args};}};
  const connectors=new Connectors(dir,hf,()=>{});
  const run=(name,args,ctx={})=>module.MCP_TOOLS.find(x=>x.name===name).run(null,args,{connectors,...ctx});
  return {run,connectors,calls};
}

test('agent lists connectors, discovers full descriptors, and calls reads without prompting',async t=>{
  const {run}=await bridge(t);
  const listed=await run('list_mcp_connectors',{});
  assert.equal(listed.connectors[0].id,'higgsfield');
  const search=await run('search_mcp_tools',{query:'assets'});
  assert.equal(search.tools[0].name,'list_assets');
  assert.deepEqual(search.tools[0].inputSchema,{type:'object'});
  assert.equal((await run('call_mcp_tool',{connector_id:'higgsfield',tool_name:'list_assets',arguments:{folder:'a'}})).name,'list_assets');
});

test('agent shows exact write arguments and keeps approval tokens out of prompts and results',async t=>{
  const {run,calls}=await bridge(t);
  let proposal;
  const result=await run('call_mcp_tool',{connector_id:'higgsfield',tool_name:'generate_video',arguments:{prompt:'review me',approved:true,get_cost:true}}, {async ask(kind,payload){assert.equal(kind,'mcp_approve');assert.equal(calls.length,0);proposal=payload;return 'yes';}});
  assert.equal(proposal.approval_token,undefined);
  assert.deepEqual(proposal.arguments,{approved:true,get_cost:true,prompt:'review me'});
  assert.equal(result.name,'generate_video');
  assert.ok(!JSON.stringify(result).includes('approval_token'));
  assert.equal(calls.length,1);
});

test('agent refuses write without a concrete yes and cannot accept model-provided approvals',async t=>{
  const {run,calls}=await bridge(t);
  for (const answer of ['no',true,{approved:true}]) {
    const result=await run('call_mcp_tool',{connector_id:'higgsfield',tool_name:'generate_video',arguments:{},approved:true,approval_token:'fake'}, {async ask(){return answer;}});
    assert.equal(result.approved,false);
  }
  await assert.rejects(run('call_mcp_tool',{connector_id:'higgsfield',tool_name:'generate_video',arguments:{}}),/승인|approval/i);
  assert.equal(calls.length,0);
});
