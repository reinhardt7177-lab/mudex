import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const fake='export class Container {constructor(ctx,env){this.ctx=ctx;this.env=env;}async startAndWaitForPorts(){}async stop(){this.signals=(this.signals??0)+1;}async destroy(){this.stops=(this.stops??0)+1;this.ctx.container.running=false;}renewActivityTimeout(){}}';
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@cloudflare/containers')return {url:'data:text/javascript,'+encodeURIComponent(fake),shortCircuit:true};return next(specifier,context);}});
const {MudexContainer}=await import('../cloud/worker.mjs');
hooks.deregister();
const tenant='a'.repeat(64);
async function instance(){const config={tenant,origin:'https://mudex.example',code:''};const ctx={container:{running:true},storage:{async get(){return config;},async put(){}},blockConcurrencyWhile(fn){this.ready=fn();}};const app=new MudexContainer(ctx,{SESSION_SECRET:'secret'});await ctx.ready;return app;}
test('shutdown refuses active requests and blocks new work until flush and stop complete',async()=>{
  const app=await instance();let finish,ready;
  const reached=new Promise(resolve=>{ready=resolve;});
  app.containerFetch=()=>new Promise(resolve=>{finish=resolve;ready();});
  const request=app.fetch(new Request('https://mudex.example/api/jobs',{method:'POST',headers:{'X-Mudex-Tenant':tenant}}));
  await reached;
  assert.equal(app.inflight,1);assert.equal(await app.hibernate(),false);
  finish(new Response('ok'));await request;
  const shutdown=app.hibernate();
  assert.equal(app.stopping,true);
  assert.equal((await app.fetch(new Request('https://mudex.example/api/jobs',{method:'POST'}))).status,409);
  assert.equal(await app.hibernate(),false);
  finish(new Response('ok'));assert.equal(await shutdown,true);
  assert.equal(app.stops,1);assert.equal(app.stopping,false);
});
test('failed flush preserves running container and recovery login restarts with real code',async()=>{
  const app=await instance();
  app.containerFetch=async()=>new Response('',{status:409});
  assert.equal(await app.hibernate(),false);assert.equal(app.stops,undefined);assert.equal(app.stopping,false);
  app.containerFetch=async()=>new Response('ok');
  await app.configure({tenant,origin:'https://mudex.example',code:'MDX-AAAA-BBBB'});
  assert.equal(app.stops,1);assert.equal(app.config.code,'MDX-AAAA-BBBB');
});
