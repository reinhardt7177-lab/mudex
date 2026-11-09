import {listFolderMedia,saveJobToFolder,conversationMarkdown,folderPermission,loadFolder,rememberFolder} from './local-folder.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createWorkspaceControls({state,api,refreshJob,refreshState,clearJob,uploadFiles,modal,toast}) {
  const bar=document.querySelector('#workspacebar');
  let link={key:null,handle:null,ready:false},busyJob=null,revision=0;
  const key=()=>{const s=state();return s.job?.uid&&s.st?.workspace_id?`${s.st.workspace_id}:${s.job.uid}`:null;};
  const context=()=>{const s=state();return {key:key(),id:s.jobId,uid:s.job?.uid,workspace:s.st?.workspace_id,name:s.job?.name??s.jobId,handle:link.handle};};
  const current=c=>c.key&&key()===c.key&&state().jobId===c.id;
  function requireCurrent(c){if(!current(c))throw new Error('선택한 작업이 바뀌었습니다. 현재 작업에서 다시 눌러 주세요.');}
  const supported=()=>typeof window.showDirectoryPicker==='function';
  function render() {
    const s=state();bar.hidden=!s.job;if(!s.job)return;
    const ready=!!s.st&&(!s.st.cloud||s.st.app_version==='cloud-v4');
    const saved=s.st?.storage_error?'저장 오류':!s.st?'저장 확인 실패':s.running?'클라우드 자동 저장 중':s.st.cloud?(s.st.saved_at?`클라우드 저장 확인 ${new Date(s.st.saved_at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`:'클라우드 자동 저장'):'이 PC에 자동 저장';
    bar.innerHTML=`<div class="workspace-actions">
      <button data-action="rename" ${ready?'':'disabled'}>이름 변경</button><button data-action="delete" class="danger" ${!ready||s.running||busyJob===s.jobId?'disabled':''}>삭제</button>
      <button data-action="folder">${link.handle?`PC: ${esc(link.handle.name)}${link.ready?'':' · 권한 확인'}`:supported()?'PC 폴더 연결':'폴더 파일 가져오기'}</button>
      ${link.handle?`<button data-action="save-pc" ${s.running||busyJob?'disabled':''}>PC에 저장</button>`:''}
      <button data-action="transcript">대화 내려받기</button>
      ${!ready?'<button data-action="restart">작업실 업데이트</button>':''}
      <span class="save-state ${s.st?.storage_error||!s.st?'error':''}" role="status" title="${esc(s.st?.storage_error??'대화·파일·결과는 작업별로 자동 저장됩니다.')}">${esc(busyJob===s.jobId?'PC 파일 처리 중':saved)}</span></div>`;
  }
  async function restore() {
    const current=key();if(current===link.key)return;
    const ticket=++revision;
    link={key:current,handle:null,ready:false};render();
    if(!current||!supported())return;
    try {const handle=await loadFolder(current);const ready=!!handle&&await folderPermission(handle);if(ticket!==revision||key()!==current)return;link.handle=handle;link.ready=ready;render();}catch { /* Selecting again remains available if persisted handles are unavailable. */ }
  }
  async function ensureFolder(c) {
    requireCurrent(c);const handle=c.handle;
    if(!handle)throw new Error('먼저 PC 폴더를 연결해 주세요.');
    if(!await folderPermission(handle,true))throw new Error('선택한 PC 폴더의 읽기·쓰기 권한을 허용해 주세요.');
    requireCurrent(c);if(link.handle!==handle)throw new Error('연결한 PC 폴더가 바뀌었습니다. 다시 눌러 주세요.');
    link.ready=true;return handle;
  }
  async function savePC(c=context()) {
    if(busyJob)throw new Error('현재 PC 파일 처리를 마친 뒤 다시 시도해 주세요.');
    requireCurrent(c);const id=c.id;
    if(state().running)throw new Error('진행 중인 작업을 마친 뒤 PC에 저장해 주세요.');
    busyJob=id;render();
    try {
      const handle=await ensureFolder(c);
      const job=await api('GET',`/api/jobs/${encodeURIComponent(id)}`);
      requireCurrent(c);if(job.uid!==c.uid||job.workspace_id!==c.workspace)throw new Error('작업의 저장 정보를 다시 확인해 주세요.');
      if(job.running)throw new Error('진행 중인 작업을 마친 뒤 PC에 저장해 주세요.');
      const result=await saveJobToFolder(handle,job,file=>fetch(`/f/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`));
      toast(`대화와 파일 ${result.files}개 저장: ${handle.name}/${result.directory}`,7000);
    } finally {busyJob=null;render();}
  }
  async function folderDialog(c) {
    const handle=await ensureFolder(c),id=c.id,jobName=c.name;
    const files=await listFolderMedia(handle);
    requireCurrent(c);
    const element=document.createElement('div');element.className='modal folder-modal';element.setAttribute('role','dialog');element.setAttribute('aria-modal','true');element.setAttribute('aria-labelledby','folder-title');
    element.innerHTML=`<div class="box"><h3 id="folder-title">PC 폴더 · ${esc(handle.name)}</h3><p>선택한 자료를 ‘${esc(jobName)}’ 클라우드 작업실로 올립니다. PC 저장은 폴더 안의 ‘무덱스 저장’에 대화와 파일을 보관합니다.</p>
      <div class="folder-files">${files.map((entry,i)=>`<label><input type="checkbox" value="${i}" ${entry.file.size<=2*1024**3?'checked':'disabled'}><span title="${esc(entry.relative)}">${esc(entry.relative)}</span><small>${(entry.file.size/1048576).toFixed(1)}MB${entry.file.size>2*1024**3?' · 2GB 초과':''}</small></label>`).join('')||'<p>가져올 영상·사진·음악 파일이 없습니다.</p>'}</div>
      <p class="folder-status" role="status"></p><div class="acts"><button data-folder="import" class="btn pri" ${files.length?'':'disabled'}>선택 파일 가져오기</button><button data-folder="save" class="btn">PC에 저장</button><button data-folder="disconnect" class="btn ghost">연결 해제</button><button data-folder="close" class="btn ghost">닫기</button></div></div>`;
    const previous=document.activeElement;
    const close=()=>{element.remove();previous?.focus();};
    element.onclick=e=>{if(e.target===element||e.target.closest('[data-folder=close]'))close();};
    element.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=[...element.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!nodes.length)return;const next=e.shiftKey?nodes.at(-1):nodes[0],edge=e.shiftKey?nodes[0]:nodes.at(-1);if(document.activeElement===edge){e.preventDefault();next.focus();}}};
    element.querySelector('[data-folder=import]').onclick=async e=>{
      if(busyJob)return;
      if(!current(c)){element.querySelector('.folder-status').textContent='작업이 바뀌었습니다. 닫고 다시 연결해 주세요.';return;}
      const selected=[...element.querySelectorAll('input:checked')].map(input=>files[Number(input.value)]);
      if(!selected.length)return;busyJob=id;render();e.target.disabled=true;
      try {const result=await uploadFiles(selected,id);element.querySelector('.folder-status').textContent=`${result.successful}개 가져옴${result.failed?` · ${result.failed}개 실패`:''}`;}
      catch(error){element.querySelector('.folder-status').textContent=error.message;}
      finally {busyJob=null;render();e.target.disabled=false;}
    };
    element.querySelector('[data-folder=save]').onclick=()=>{close();savePC(c).catch(e=>toast(e.message,5000));};
    element.querySelector('[data-folder=disconnect]').onclick=async()=>{await rememberFolder(c.key,null);if(link.key===c.key){revision++;link={key:c.key,handle:null,ready:false};}close();render();};
    document.body.append(element);element.querySelector('[data-folder=close]').focus();
  }
  bar.onclick=async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const s=state(),id=s.jobId;
    try {
      if(button.dataset.action==='rename')return modal({title:'작업 이름 변경',text:'대화와 파일은 그대로 이어집니다.',value:s.job.name??id,ok:'변경',onOk:async name=>{await api('PATCH',`/api/jobs/${encodeURIComponent(id)}`,{name});await refreshJob();await refreshState();}});
      if(button.dataset.action==='delete') {
        if(!confirm(`‘${s.job.name??id}’의 클라우드 대화와 파일을 삭제할까요? PC에 저장한 파일은 보관됩니다.`))return;
        const linkedKey=key();await api('DELETE',`/api/jobs/${encodeURIComponent(id)}`);if(linkedKey)await rememberFolder(linkedKey,null).catch(()=>{});clearJob(id);await refreshState();toast('작업을 삭제했습니다.');
      }
      if(button.dataset.action==='transcript') {
        const job=await api('GET',`/api/jobs/${encodeURIComponent(id)}`),url=URL.createObjectURL(new Blob([conversationMarkdown(job)],{type:'text/markdown;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download=(job.name??id).replace(/[\\/:*?"<>|]/g,'_')+'-대화.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
      if(button.dataset.action==='restart') {await api('POST','/cloud/restart');location.reload();}
      if(button.dataset.action==='save-pc')await savePC();
      if(button.dataset.action==='folder') {
        if(!supported()){document.querySelector('#folderPick').click();return;}
        let c=context();if(!c.key)throw new Error('작업실 업데이트 후 PC 폴더를 연결해 주세요.');
        if(!c.handle){const selected=await window.showDirectoryPicker({id:'mudex-workspace',mode:'readwrite'});requireCurrent(c);await rememberFolder(c.key,selected);requireCurrent(c);revision++;link={key:c.key,handle:selected,ready:true};c={...c,handle:selected};render();}
        await folderDialog(c);
      }
    }catch(error){if(error.name!=='AbortError')toast(error.message,6000);}
  };
  document.querySelector('#folderPick').onchange=async event=>{
    const files=[...event.target.files].filter(file=>/\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp)$/i.test(file.name)).map(file=>({file,relative:file.webkitRelativePath.split('/').slice(1).join('/')}));event.target.value='';
    if(files.length&&confirm(`폴더의 영상·사진·음악 ${files.length}개를 클라우드 작업실로 올릴까요?`))await uploadFiles(files,state().jobId);
  };
  return {render,restore};
}
