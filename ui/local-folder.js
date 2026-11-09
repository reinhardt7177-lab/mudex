const MEDIA=/\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp)$/i;
export async function listFolderMedia(directory,prefix='',depth=0) {
  if(depth>16)throw new Error('폴더가 너무 깊습니다. 사용할 자료 폴더를 직접 선택해 주세요.');
  const files=[];
  for await(const [name,handle] of directory.entries()) {
    if(name.startsWith('.') || name==='무덱스 저장')continue;
    if(handle.kind==='directory')files.push(...await listFolderMedia(handle,prefix+name+'/',depth+1));
    else if(MEDIA.test(name)) {const file=await handle.getFile();files.push({file,relative:prefix+name});}
    if(files.length>2000)throw new Error('한 번에 2,000개까지 가져올 수 있습니다. 더 작은 자료 폴더를 선택해 주세요.');
  }
  return files.sort((a,b)=>a.relative.localeCompare(b.relative));
}
export function conversationMarkdown(job) {
  const lines=[`# ${String(job.name??job.id).replace(/[\r\n]/g,' ')}`,''];
  for(const event of job.events??[]) {
    if(event.type==='user')lines.push('## 나',String(event.text??''),'');
    else if(event.type==='assistant')lines.push('## 무덱스',String(event.text??''),'');
    else if(event.type==='error')lines.push('## 작업 오류',String(event.message??''),'');
    else if(event.type==='done'&&event.verify?.file)lines.push(`결과 파일: ${event.verify.file}`,'');
  }
  return lines.join('\n');
}
async function write(directory,relative,value) {
  const parts=relative.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\\\x00-\x1f:*?"<>|]/.test(p)))throw new Error('저장할 파일 경로가 올바르지 않습니다.');
  let target=directory;
  for(const part of parts.slice(0,-1))target=await target.getDirectoryHandle(part,{create:true});
  const file=await target.getFileHandle(parts.at(-1),{create:true}),stream=await file.createWritable();
  try {if(value instanceof ReadableStream)await value.pipeTo(stream);else {await stream.write(value);await stream.close();}}
  catch(error){await stream.abort?.().catch(()=>{});throw error;}
}
export async function saveJobToFolder(directory,job,fetchFile,onProgress=()=>{}) {
  // Validate every remote path before creating files in the user-selected directory.
  for(const file of job.files??[])if(file.file.split('/').some(p=>!p||p==='.'||p==='..'||/[\\\x00-\x1f:*?"<>|]/.test(p)))throw new Error('저장할 파일 경로가 올바르지 않습니다.');
  if(!job.workspace_id || !job.uid)throw new Error('작업실 식별 정보를 확인한 뒤 다시 저장해 주세요.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(job.workspace_id+'\0'+job.uid)))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,20);
  const base='작업-'+hash;
  const root=await (await directory.getDirectoryHandle('무덱스 저장',{create:true})).getDirectoryHandle(base,{create:true});
  await write(root,'대화.md',conversationMarkdown(job));
  await write(root,'작업.json',JSON.stringify({version:1,id:job.id,uid:job.uid,workspace_id:job.workspace_id,name:job.name??job.id,exported_at:new Date().toISOString(),events:job.events??[],files:job.files??[]},null,2));
  let count=2;
  for(const file of job.files??[]) {
    onProgress(file.file);
    const response=await fetchFile(file.file);
    if(!response.ok)throw new Error(`파일을 내려받지 못했습니다: ${file.file}`);
    const value=response.body;
    await write(root,file.file,value);
    count++;
  }
  return {directory:'무덱스 저장/'+base,files:count};
}
export async function folderPermission(handle,request=false) {
  if(await handle.queryPermission({mode:'readwrite'})==='granted')return true;
  return request && await handle.requestPermission({mode:'readwrite'})==='granted';
}
async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('mudex-local-folders',1);r.onupgradeneeded=()=>r.result.createObjectStore('links');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function loadFolder(key) {
  const db=await database();try{return await new Promise((resolve,reject)=>{const r=db.transaction('links').objectStore('links').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}finally{db.close();}
}
export async function rememberFolder(key,handle) {
  const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('links','readwrite');const store=tx.objectStore('links');handle?store.put(handle,key):store.delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
