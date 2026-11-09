import { Container } from '@cloudflare/containers';
import { storageToken } from './auth.mjs';
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});

export class MudexContainer extends Container {
  defaultPort=4870;
  sleepAfter='10m';
  enableInternet=true;
  inflight=0;
  stopping=false;
  constructor(ctx,env) {
    super(ctx,env);
    this.ctx=ctx; this.env=env;
    ctx.blockConcurrencyWhile(async()=>{this.config=await ctx.storage.get('config');});
  }
  async configure(config) {
    if (this.config && this.config.tenant!==config.tenant) throw new Error('Tenant mismatch');
    if(this.config && (this.config.code!==config.code || this.config.origin!==config.origin) && this.ctx.container.running && !await this.hibernate()) throw new Error('Workspace is busy');
    this.config=config;
    await this.ctx.storage.put('config',config);
  }
  async ensureConfigured(tenant,origin) {
    if (!this.config) await this.configure({tenant,origin,code:''});
    if(this.config.tenant!==tenant) throw new Error('Tenant mismatch');
  }
  async fetch(request) {
    if (this.stopping) return json({error:'파일 저장 중입니다. 잠시 후 다시 시도해 주세요.'},409);
    if (!this.config || this.config.tenant!==request.headers.get('X-Mudex-Tenant')) return json({error:'강사 코드로 다시 입장해 주세요.'},401);
    this.inflight++;
    try {
    const {origin,tenant,code}=this.config;
    await this.startAndWaitForPorts({
      startOptions:{envVars:{PORT:'4870',MUDEX_PUBLIC_URL:origin,MUDEX_DATA_ROOT:'/mudex-store',MUDEX_STORE_URL:`${origin}/__storage/${tenant}/`,MUDEX_STORE_TOKEN:await storageToken(tenant,this.env.SESSION_SECRET),MUDEX_CODE:code}},
      cancellationOptions:{instanceGetTimeoutMS:90000,portReadyTimeoutMS:180000},
    });
    return await this.containerFetch(request);
    } finally {this.inflight--;}
  }
  async hibernate() {
    if(this.inflight || this.stopping) return false;
    this.stopping=true;
    try {
      if (!this.ctx.container.running) return true;
      const response=await this.containerFetch('http://container/__cloud/flush',{method:'POST'});
      if (!response.ok) return false;
      await this.destroy();
      return true;
    } finally {this.stopping=false;}
  }
  async onActivityExpired() {
    if (!await this.hibernate()) this.renewActivityTimeout();
  }
}

export {default} from './router.mjs';
