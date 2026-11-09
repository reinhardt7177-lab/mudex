import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class CloudStorage {
  constructor(root, base, token, request = fetch, include = () => true) {
    Object.assign(this, {root:path.resolve(root), base, token, request, include});
    this.remote = new Map();
    this.queue = Promise.resolve();
    this.error = null;
    this.lastSaved = null;
  }
  url(key = '', query = '') { return this.base + key.split('/').map(encodeURIComponent).join('/') + query; }
  async call(key, init = {}, query = '') {
    const response = await this.request(this.url(key, query), {...init, headers:{Authorization:`Bearer ${this.token}`, ...init.headers}, ...(init.body ? {duplex:'half'} : {})});
    if (!response.ok) throw new Error(`클라우드 파일 저장 실패 (${response.status})`);
    return response;
  }
  local(key) {
    const abs = path.resolve(this.root, key);
    if (!/^(data|jobs)\//.test(key) || key.includes('\\') || key.split('/').some(x=>!x || x==='.' || x==='..') || !abs.startsWith(this.root+path.sep)) throw new Error('Invalid persisted path');
    return abs;
  }
  stamp(file) { const s=fs.statSync(file); return `${s.size}:${s.mtimeMs}`; }
  async restore() {
    const keys = await (await this.call('', {}, '?list')).json();
    for (const key of keys) {
      const dst = this.local(key);
      fs.mkdirSync(path.dirname(dst), {recursive:true});
      const response = await this.call(key);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dst));
      this.remote.set(key, this.stamp(dst));
    }
  }
  sync(before) {
    const run = async () => {
      if(before) await before();
      const present = new Set();
      for (const dir of ['data','jobs']) {
        const folder=path.join(this.root,dir);
        if (!fs.existsSync(folder)) continue;
        for (const f of fs.readdirSync(folder,{recursive:true,withFileTypes:true})) {
          if (!f.isFile()) continue;
          const abs=path.join(f.parentPath,f.name), key=path.relative(this.root,abs).split(path.sep).join('/');
          present.add(key);
          if (!this.include(key) || /\.part$/.test(key) || /^jobs\/[^/]+\/(tmp|\.mudex\/thumbs)\//.test(key)) continue;
          const stamp=this.stamp(abs);
          if (this.remote.get(key)===stamp) continue;
          const size=fs.statSync(abs).size;
          if (size > 32*1024*1024) {
            const {uploadId} = await (await this.call(key,{method:'POST'},'?multipart=create')).json();
            const parts=[];
            try {
              for(let offset=0,n=1;offset<size;offset+=16*1024*1024,n++) {
                const p=await (await this.call(key,{method:'PUT',body:fs.createReadStream(abs,{start:offset,end:Math.min(size-1,offset+16*1024*1024-1)})},`?uploadId=${encodeURIComponent(uploadId)}&partNumber=${n}`)).json();
                parts.push(p);
              }
              await this.call(key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parts})},`?uploadId=${encodeURIComponent(uploadId)}`);
            } catch(e) { await this.call(key,{method:'DELETE'},`?uploadId=${encodeURIComponent(uploadId)}`).catch(()=>{}); throw e; }
          } else {
            await this.call(key,{method:'PUT',body:fs.createReadStream(abs)});
          }
          this.remote.set(key,stamp);
        }
      }
      for(const key of this.remote.keys()) if(!present.has(key) && this.include(key)) {
        await this.call(key,{method:'DELETE'}); this.remote.delete(key);
      }
      this.error=null;
      this.lastSaved=new Date().toISOString();
    };
    this.queue=this.queue.catch(()=>{}).then(run).catch(e=>{this.error=e.message;throw e;});
    return this.queue;
  }
}
