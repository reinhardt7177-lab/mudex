import test from 'node:test';
import assert from 'node:assert/strict';

const ID='12345678-1234-4234-8234-123456789abc';
const generation={id:ID,type:'video',status:'completed',model:'kling',createdAt:1730000000000,params:{prompt:'우리 학교 소개'},results:{rawUrl:'https://cdn.example/video.mp4',thumbnailUrl:'https://cdn.example/thumb.jpg',durationSec:5}};
async function fixture(t, response={items:[generation],next_cursor:0}) {
  const mod=await import('../app/higgsfield-library.mjs').catch(()=>({}));
  assert.equal(typeof mod.HiggsfieldLibrary,'function','video library service exists');
  const calls=[],hf={loggedIn:true,token:{access_token:'test'},async call(name,args){calls.push({name,args});return response;}};
  let now=1000;const imported=[];
  const library=new mod.HiggsfieldLibrary(hf,{now:()=>now,download:async(ws,urls,args,ctx)=>{imported.push({ws,urls,args,ctx});return {files:['imported/video.mp4'],bytes:4};}});
  return {library,hf,calls,imported,advance:()=>{now+=16*60_000;}};
}
test('video library uses read-only completed-video catalog with cursor zero and opaque selection',async t=>{
  const {library,calls,imported}=await fixture(t);
  const page=await library.list({source:'generations',cursor:0});
  assert.deepEqual(calls,[{name:'show_generations',args:{type:'video',only_completed:true,size:24,cursor:0}}]);
  assert.equal(page.next_cursor,0);assert.equal(page.items.length,1);assert.equal(page.items[0].title,'우리 학교 소개');
  assert.notEqual(page.items[0].key,ID);assert.equal(page.items[0].url,generation.results.rawUrl);
  await library.import({}, {key:page.items[0].key});
  assert.deepEqual(imported[0].urls,[generation.results.rawUrl]);
  await assert.rejects(()=>library.import({}, {key:'https://internal/evil'}),/다시|목록/);
});
test('uploaded videos are independently paginated and nonvideo/incomplete rows never appear',async t=>{
  const {library,calls}=await fixture(t,{items:[{id:ID,type:'video',url:'https://cdn.example/upload.mp4',created_at:1730000000},{...generation,type:'image'},{...generation,status:'pending'}],next_cursor:null});
  const page=await library.list({source:'uploads'});assert.equal(page.items.length,1);
  assert.deepEqual(calls,[{name:'show_medias',args:{type:'video',size:24}}]);
  assert.equal(page.items[0].created_at,1730000000000);
});
test('selection expires and cannot cross a disconnect or account change',async t=>{
  const {library,hf,advance}=await fixture(t);
  let page=await library.list({});advance();await assert.rejects(()=>library.import({}, {key:page.items[0].key}),/다시|만료/);
  page=await library.list({});hf.token={access_token:'other'};await assert.rejects(()=>library.import({}, {key:page.items[0].key}),/다시|연결/);
  hf.loggedIn=false;await assert.rejects(()=>library.list({}),/연결|로그인/);
});
test('catalog errors and unsafe URLs cannot become selectable videos',async t=>{
  const {library,calls}=await fixture(t,{error:'권한 없음'});
  await assert.rejects(()=>library.list({}),/권한 없음/);
  await assert.rejects(()=>library.list({source:'delete_video'}),/종류/);
  await assert.rejects(()=>library.list({cursor:{arbitrary:true}}),/페이지/);
  assert.equal(calls.length,1);
});
test('empty pages preserve provider cursor and malformed responses fail visibly',async t=>{
  const {library}=await fixture(t,{items:[],next_cursor:23});
  assert.deepEqual(await library.list({}),{items:[],next_cursor:23});
  const bad=await fixture(t,{text:'not a gallery'});await assert.rejects(()=>bad.library.list({}),/목록|응답/);
  const unsafe=await fixture(t,{items:[{...generation,results:{rawUrl:'javascript:alert(1)'}},{...generation,results:{rawUrl:'http://localhost/clip.mp4'}}]});
  assert.equal((await unsafe.library.list({})).items.length,0);
});
test('a login changed during catalog lookup cannot bind old-account videos to the new account',async t=>{
  const {library,hf}=await fixture(t);
  hf.call=async()=>{hf.token={access_token:'new-account'};return {items:[generation]};};
  await assert.rejects(()=>library.list({}),/연결이 바뀌/);
});
