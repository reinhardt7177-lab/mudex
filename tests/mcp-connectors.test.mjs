import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Connectors, SAFE_TOOLS} from '../app/connectors.mjs';

const catalog = [
  {name:'balance', inputSchema:{type:'object'}},
  {name:'list_assets', description:'Browse existing video assets', inputSchema:{type:'object',properties:{folder:{type:'string'}}}},
  {name:'job_status', inputSchema:{type:'object'}},
  {name:'generate_video', annotations:{readOnlyHint:true}, inputSchema:{type:'object'}},
  {name:'delete_asset', annotations:{readOnlyHint:true}, inputSchema:{type:'object'}},
  {name:'get_publish', annotations:{readOnlyHint:true}, inputSchema:{type:'object'}},
  {name:'use_service', annotations:{readOnlyHint:true}, inputSchema:{type:'object',properties:{action:{type:'string'}}}},
  {name:'mystery', inputSchema:{type:'object'}},
];
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mudex-mcp-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls=[];
  const hf={loggedIn:true,async listTools(){return structuredClone(catalog);},async call(name,args){calls.push({name,args});return {ok:true,name,args};},logout(){this.loggedIn=false;}};
  const connectors=new Connectors(dir,hf,()=>{});
  return {connectors,hf,calls};
}

test('discovery keeps full schemas, annotations and unknown or mutating tools',async t=>{
  const {connectors}=setup(t);
  const tools=await connectors.tools('higgsfield');
  assert.equal(tools.find(x=>x.name==='generate_video').annotations?.readOnlyHint,true);
  const result=await connectors.search('',50);
  assert.equal(result.total,8);
  assert.equal(result.tools.find(x=>x.name==='mystery').policy.approval_required,true);
  const assets=await connectors.search('video assets');
  assert.equal(assets.tools[0].connector.id,'higgsfield');
  assert.deepEqual(assets.tools[0].inputSchema.properties.folder,{type:'string'});
  assert.ok(SAFE_TOOLS.includes('balance'));
});

test('reads execute directly; dangerous names, control arguments and unknown tools need approval',async t=>{
  const {connectors,calls}=setup(t);
  assert.equal((await connectors.call('higgsfield','list_assets',{folder:'existing'})).ok,true);
  assert.equal((await connectors.call('higgsfield','job_status',{jobId:'existing'})).ok,true);
  for (const [name,args] of [
    ['generate_video',{get_cost:true,approved:true}], ['delete_asset',{}], ['get_publish',{}],
    ['mystery',{approved:true}], ['use_service',{}], ['use_service',{action:'generate'}],
    ['list_assets',{nested:{action:'delete_asset'}}], ['list_assets',{execute:true}],
  ]) {
    const proposal=await connectors.prepareCall('higgsfield',name,args);
    assert.equal(proposal.approval_required,true, name+JSON.stringify(args));
    await assert.rejects(connectors.call('higgsfield',name,args),/승인|approval/i);
  }
  assert.equal((await connectors.prepareCall('higgsfield','use_service',{action:'list_assets'})).approval_required,true);
  assert.equal(calls.length,2);
  await assert.rejects(connectors.call('higgsfield','not_in_catalog'),/도구|tool/i);
});

test('approval tokens bind full canonical arguments, expire and allow one call only',async t=>{
  const {connectors,calls}=setup(t);
  const args={prompt:'original',params:{b:2,a:1}};
  const p=await connectors.prepareCall('higgsfield','generate_video',args);
  assert.equal(calls.length,0);
  assert.equal(typeof p.approval_token,'string');
  await assert.rejects(connectors.call('higgsfield','generate_video',args,{approval_token:true}),/승인|approval/i);
  await assert.rejects(connectors.call('higgsfield','generate_video',args,true),/승인|approval/i);
  await assert.rejects(connectors.call('higgsfield','generate_video',{...args,prompt:'different'},{approval_token:p.approval_token}),/승인|approval/i);
  const fresh=await connectors.prepareCall('higgsfield','generate_video',args);
  const result=await connectors.call('higgsfield','generate_video',{params:{a:1,b:2},prompt:'original'},{approval_token:fresh.approval_token});
  assert.equal(result.ok,true);
  await assert.rejects(connectors.call('higgsfield','generate_video',args,{approval_token:fresh.approval_token}),/승인|approval/i);
  const expiring=await connectors.prepareCall('higgsfield','generate_video',args);
  const now=Date.now;t.mock.method(Date,'now',()=>now()+301000);
  await assert.rejects(connectors.call('higgsfield','generate_video',args,{approval_token:expiring.approval_token}),/승인|approval/i);
  assert.equal(calls.length,1);
});

test('disconnect invalidates approval, including after reconnection, and argument snapshots cannot change',async t=>{
  const {connectors,hf,calls}=setup(t);
  const args={prompt:'keep'};
  const proposal=await connectors.prepareCall('higgsfield','generate_video',args);
  args.prompt='changed';
  assert.equal(proposal.arguments.prompt,'keep');
  connectors.disconnect('higgsfield');hf.loggedIn=true;
  await assert.rejects(connectors.call('higgsfield','generate_video',{prompt:'keep'},{approval_token:proposal.approval_token}),/승인|approval/i);
  assert.equal(calls.length,0);
});

test('practice tools preserve simulated behavior and use the same approval policy',async t=>{
  const {connectors}=setup(t);
  const c=connectors.add({name:'Practice',url:'https://practice.example/mcp',practice:true});
  await assert.rejects(connectors.prepareCall(c.id,'balance'),/연결/);
  connectors.practiceApprove(c.id);
  assert.equal((await connectors.call(c.id,'balance')).credits,200);
  await assert.rejects(connectors.call(c.id,'generate_video',{approved:true}),/승인|approval/i);
});

test('unknown tools cannot claim read access through invented actions or destructive hints',async t=>{
  const {connectors,hf,calls}=setup(t);
  const list=hf.listTools;
  hf.listTools=async()=>[...await list(),{name:'list_danger',annotations:{readOnlyHint:true,destructiveHint:true},inputSchema:{type:'object'}}];
  assert.equal((await connectors.prepareCall('higgsfield','mystery',{action:'list_assets'})).approval_required,true);
  assert.equal((await connectors.prepareCall('higgsfield','list_danger',{})).approval_required,true);
  assert.equal(calls.length,0);
});

test('approval cannot be transferred to a different tool, connector, or changed server address',async t=>{
  const {connectors,calls}=setup(t);
  const p=await connectors.prepareCall('higgsfield','generate_video',{});
  await assert.rejects(connectors.call('higgsfield','delete_asset',{}, {approval_token:p.approval_token}),/승인|approval/i);
  const fresh=await connectors.prepareCall('higgsfield','generate_video',{});
  connectors.get('higgsfield').url='https://replacement.example/mcp';
  connectors.clients.set('higgsfield',{loggedIn:true,async listTools(){return catalog;},async call(){throw new Error('must not execute');}});
  await assert.rejects(connectors.call('higgsfield','generate_video',{}, {approval_token:fresh.approval_token}),/승인|approval/i);
  assert.equal(calls.length,0);
});

test('negative hints, disguised mutations, mode selectors and unknown multiplexers require approval',async t=>{
  const {connectors,hf,calls}=setup(t);
  hf.listTools=async()=>[
    {name:'get_asset',annotations:{readOnlyHint:false},inputSchema:{type:'object'}},
    {name:'archive_project',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'rename_workspace',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'get_archive_project',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'get_rename_workspace',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'mystery',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'search_service',annotations:{readOnlyHint:true},inputSchema:{type:'object'}},
    {name:'list_options',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{options:{type:'object',properties:{mode:{type:'string'}}}}}},
    {name:'get_service',inputSchema:{oneOf:[{type:'object',properties:{mode:{type:'string'}}}]}},
    {name:'search_untyped',annotations:{readOnlyHint:true}},
    {name:'service',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{action:{type:'string'}}}},
  ];
  for (const [name,args] of [
    ['get_asset',{}],['archive_project',{}],['rename_workspace',{}],['mystery',{}],
    ['get_archive_project',{}],['get_rename_workspace',{}],['search_untyped',{}],
    ['search_service',{mode:'delete'}],['search_service',{nested:{mode:'archive'}}],
    ['search_service',{rename:'changed'}],['list_options',{}],['get_service',{}],
    ['service',{action:'list_assets'}],
  ]) {
    assert.equal((await connectors.prepareCall('higgsfield',name,args)).approval_required,true,name+JSON.stringify(args));
    await assert.rejects(connectors.call('higgsfield',name,args),/승인|approval/i);
  }
  assert.equal(calls.length,0);
});
