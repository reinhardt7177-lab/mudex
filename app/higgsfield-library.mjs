import crypto from 'node:crypto';
import {downloadHiggsfieldMedia} from './remote-media.mjs';

const TTL=15*60_000,MAX_ENTRIES=480;
function mediaUrl(value) {
  try {
    const u=new URL(value);
    if(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443'))return u.href;
  }catch{}
  return null;
}
const date=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):null;};

export class HiggsfieldLibrary {
  constructor(hf,{now=Date.now,download=downloadHiggsfieldMedia}={}) {
    this.hf=hf;this.now=now;this.download=download;this.entries=new Map();
  }
  requireLogin(){if(!this.hf.loggedIn)throw Object.assign(new Error('힉스필드를 연결한 뒤 목록을 다시 열어 주세요.'),{status:400});}
  clear(){this.entries.clear();}
  auth(){return this.hf.authEpoch??this.hf.token;}
  async list({source='generations',cursor}={}) {
    this.requireLogin();
    if(!['generations','uploads'].includes(source))throw Object.assign(new Error('영상 목록 종류를 확인해 주세요.'),{status:400});
    if(cursor!==undefined&&(typeof cursor!=='number'&&typeof cursor!=='string'||!/^\d+(\.\d+)?$/.test(String(cursor))||!Number.isFinite(Number(cursor))))throw Object.assign(new Error('페이지 정보를 확인해 주세요.'),{status:400});
    const auth=this.auth();
    const result=await this.hf.call(source==='uploads'?'show_medias':'show_generations',{type:'video',...(source==='generations'?{only_completed:true}:{}),size:24,...(cursor!==undefined?{cursor:Number(cursor)}:{})});
    this.requireLogin();
    if(auth!==this.auth())throw new Error('조회 중 힉스필드 연결이 바뀌었습니다. 목록을 다시 불러와 주세요.');
    if(result?.error)throw new Error(String(result.error));
    if(!Array.isArray(result?.items))throw new Error('힉스필드 영상 목록 응답을 읽지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
    const now=this.now();
    for(const [key,entry] of this.entries)if(entry.expires<=now||entry.auth!==auth)this.entries.delete(key);
    const items=[];
    for(const item of result.items.slice(0,100)) {
      if(!item||item.type!=='video'||typeof item.id!=='string'||(source==='generations'&&item.status!=='completed'))continue;
      const url=mediaUrl(source==='uploads'?item.url:item.results?.rawUrl);
      if(!url)continue;
      const identity=`${source}:${item.id}`;
      const existing=[...this.entries].find(([,entry])=>entry.identity===identity);
      const key=existing?.[0]??crypto.randomUUID();
      const title=String(source==='uploads'?'업로드한 영상':item.params?.prompt||'생성한 영상').slice(0,500);
      const row={key,id:item.id,source,title,url,thumbnail:mediaUrl(item.results?.thumbnailUrl),model:String(item.model??''),duration:Number(item.results?.durationSec??item.params?.duration)||null,created_at:date(item.createdAt??item.created_at)};
      this.entries.set(key,{identity,auth,expires:now+TTL,url});
      items.push(row);
    }
    while(this.entries.size>MAX_ENTRIES)this.entries.delete(this.entries.keys().next().value);
    return {items,next_cursor:result.next_cursor??null};
  }
  async import(ws,{key}={},ctx={}) {
    this.requireLogin();
    const entry=this.entries.get(key);
    if(!entry||entry.expires<=this.now()||entry.auth!==this.auth())throw Object.assign(new Error('선택한 영상 목록이 만료되었거나 연결이 바뀌었습니다. 목록을 새로고침하고 다시 선택해 주세요.'),{status:400});
    return this.download(ws,[entry.url],{name:'higgsfield'},ctx);
  }
}
