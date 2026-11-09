const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const when=value=>value?new Date(value).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';

export function openHiggsfieldLibrary({state,api,refreshJob,refreshState,openConnectors,upload,toast}) {
  const initial=state(),job=initial.job;
  if(!job?.uid){toast('먼저 작업을 만들어 주세요.');return;}
  const current=()=>state().jobId===job.id&&state().job?.uid===job.uid&&state().job?.workspace_id===job.workspace_id;
  const previous=document.activeElement,el=document.createElement('div');
  el.className='modal hf-library';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','hf-library-title');
  el.innerHTML=`<div class="hf-window"><header class="hf-header"><div><h2 id="hf-library-title">힉스필드 영상 가져오기</h2><p>가져올 작업: ${esc(job.name??job.id)}</p></div><button type="button" data-hf="close" class="btn ghost" aria-label="영상 목록 닫기">닫기</button></header>
    <div class="hf-toolbar"><div role="group" aria-label="영상 종류"><button class="btn" data-source="generations" aria-pressed="true">생성한 영상</button><button class="btn ghost" data-source="uploads" aria-pressed="false">업로드한 영상</button></div><button class="btn ghost" data-hf="refresh">새로고침</button></div>
    <p class="hf-notice" role="status" aria-live="polite"></p><div class="hf-recovery" hidden></div>
    <div class="hf-content"><section class="hf-list-panel" aria-label="힉스필드 영상 목록"><div class="hf-list"></div><button class="btn ghost hf-more" data-hf="more" hidden>더 보기</button></section><section class="hf-preview" aria-label="선택 영상 미리보기"><div class="hf-player"></div><div class="hf-detail"><p>목록에서 영상을 누르면 재생해서 확인할 수 있습니다.</p></div></section></div>
    <footer class="hf-footer"><span class="hf-count">선택한 영상 없음</span><button class="btn ghost" data-hf="clear">선택 해제</button><button class="btn vio" data-hf="import" disabled>선택 영상 가져오기</button><p>기존 영상 파일만 가져옵니다. 가져온 뒤 채팅으로 편집을 요청하세요.</p></footer></div>`;
  const $=selector=>el.querySelector(selector),cache={generations:{items:[],next:null,loaded:false},uploads:{items:[],next:null,loaded:false}},selected=new Map(),imported=new Set(),errors=new Map();
  let source='generations',preview=null,loading=false,importing=false,closed=false,revision=0;
  function notice(message){$('.hf-notice').textContent=message;}
  function footer(){
    const count=selected.size;
    $('.hf-count').textContent=count?`${count}개 선택`:'선택한 영상 없음';
    $('[data-hf=import]').textContent=count?`선택 ${count}개 가져오기`:'선택 영상 가져오기';
    $('[data-hf=import]').disabled=!count||importing||loading;
    $('[data-hf=clear]').disabled=!count||importing;
    $('[data-hf=close]').disabled=importing;
    $('[data-hf=refresh]').disabled=importing||loading;
    $('[data-hf=more]').disabled=importing||loading;
    for(const b of el.querySelectorAll('[data-source]'))b.disabled=importing||loading;
    for(const input of el.querySelectorAll('input[type=checkbox]'))input.disabled=importing||imported.has(input.value);
  }
  function close(){
    if(importing)return;
    closed=true;revision++;window.removeEventListener('mudex-hf-changed',onLogin);el.querySelector('video')?.pause();el.remove();previous?.focus();
  }
  function renderList(){
    const page=cache[source];
    $('.hf-list').innerHTML=page.items.map(item=>`<article class="hf-row ${preview?.key===item.key?'is-preview':''} ${selected.has(item.key)?'is-selected':''}" data-key="${esc(item.key)}"><label class="hf-select"><input type="checkbox" value="${esc(item.key)}" aria-label="${esc(item.title)} 선택" ${selected.has(item.key)?'checked':''} ${imported.has(item.key)?'disabled':''}></label><button class="hf-item" data-preview="${esc(item.key)}"><span class="hf-thumb">${safeUrl(item.thumbnail)?`<img src="${esc(safeUrl(item.thumbnail))}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<span aria-hidden="true">▶</span>'}${item.duration?`<small>${Number(item.duration).toFixed(0)}초</small>`:''}</span><span class="hf-caption"><b>${esc(item.title)}</b><small>${esc([item.model,when(item.created_at)].filter(Boolean).join(' · '))}</small><small>${imported.has(item.key)?'✓ 가져옴':errors.has(item.key)?esc(errors.get(item.key)):''}</small></span></button></article>`).join('')||`<div class="hf-empty">${loading?'영상 목록을 불러오는 중입니다.':page.loaded?'이 페이지에 가져올 영상이 없습니다. 아래의 더 보기로 다음 페이지를 확인할 수 있습니다.':'영상 목록을 불러오지 못했습니다.'}</div>`;
    $('[data-hf=more]').hidden=page.next===null||page.next===undefined;
    $('[data-hf=more]').disabled=loading||importing;
    footer();
  }
  function showPreview(item){
    preview=item;$('.hf-player').innerHTML=`<video controls playsinline preload="none" ${safeUrl(item.thumbnail)?`poster="${esc(safeUrl(item.thumbnail))}"`:''} src="${esc(safeUrl(item.url))}"></video>`;
    $('.hf-detail').innerHTML=`<b>${esc(item.title)}</b><p>${esc([item.model,when(item.created_at),item.duration?`${item.duration}초`:''].filter(Boolean).join(' · '))}</p><p class="hf-playback-note" role="status"></p>`;
    $('.hf-player video').onerror=()=>{$('.hf-playback-note').textContent='미리보기를 재생하지 못했습니다. 목록을 새로고침하거나 영상을 가져온 뒤 확인해 주세요.';};
    for(const row of el.querySelectorAll('.hf-row'))row.classList.toggle('is-preview',row.dataset.key===item.key);
  }
  function recovery(error){
    const box=$('.hf-recovery');box.hidden=false;
    const provider=error?.code==='higgsfield_session_rejected';
    box.innerHTML=`<button class="btn" data-hf="check">연결 확인</button><button class="btn ghost" data-hf="login">힉스필드 다시 연결</button><button class="btn ghost" data-hf="connectors">연결 설정</button><button class="btn ghost" data-hf="upload">PC 영상 파일 올리기</button>${provider?'<a href="https://github.com/higgsfield-ai/cli/issues/114" target="_blank" rel="noopener noreferrer">재로그인 후에도 반복되는 인증 오류 안내</a>':''}`;
  }
  async function load(reset=false){
    if(loading||importing||closed)return;
    if(state().st?.cloud&&state().st.app_version!=='cloud-v5'){
      notice('새 영상 목록 기능을 적용하려면 진행 중인 작업을 마친 뒤 ‘작업실 업데이트’를 눌러 주세요.');
      $('.hf-recovery').hidden=false;$('.hf-recovery').innerHTML='<button class="btn vio" data-hf="update">작업실 업데이트</button>';return;
    }
    const target=source,page=cache[target],ticket=++revision;
    if(reset){for(const item of page.items){selected.delete(item.key);errors.delete(item.key);}page.items=[];page.next=null;page.loaded=false;preview=null;$('.hf-player').innerHTML='';$('.hf-detail').innerHTML='<p>목록에서 영상을 눌러 미리보세요.</p>';}
    loading=true;notice('힉스필드 영상 목록을 불러오는 중입니다.');$('.hf-recovery').hidden=true;renderList();
    try{
      const data=await api('GET',`/api/hf/library?source=${target}${page.loaded&&page.next!=null?'&cursor='+encodeURIComponent(page.next):''}`);
      if(closed||ticket!==revision)return;
      const known=new Set(page.items.map(item=>item.key));for(const item of data.items??[])if(!known.has(item.key)){known.add(item.key);page.items.push(item);}
      const repeated=page.loaded&&page.next===data.next_cursor;
      page.next=repeated?null:data.next_cursor;page.loaded=true;
      notice(page.items.length?`${page.items.length}개 표시 · 미리보기로 확인한 뒤 체크해 주세요.`:page.next!=null?'이 페이지에 영상이 없습니다. 더 보기를 눌러 다음 페이지를 확인하세요.':'가져올 영상이 없습니다. 다른 영상 종류를 선택하거나 PC 파일을 올려 주세요.');
      if(!preview&&page.items.length)showPreview(page.items[0]);
    }catch(error){if(!closed){notice(error.message);recovery(error);}}
    finally{loading=false;if(!closed)renderList();}
  }
  async function importSelected(){
    if(importing||!selected.size)return;
    if(!current()){notice('현재 작업이 바뀌었습니다. 목록을 닫고 가져올 작업에서 다시 열어 주세요.');return;}
    if(state().running){notice('진행 중인 영상 작업을 마친 뒤 가져와 주세요.');return;}
    importing=true;footer();let success=0,failed=0;
    const entries=[...selected.values()];
    try{
      for(let index=0;index<entries.length;index++){
        if(!current()){notice('작업이 바뀌어 남은 가져오기를 중단했습니다.');break;}
        const item=entries[index];notice(`영상 가져오는 중 ${index+1}/${entries.length} · ${item.title.slice(0,60)}`);
        try{await api('POST',`/api/jobs/${encodeURIComponent(job.id)}/hf-import`,{key:item.key,job_uid:job.uid});success++;selected.delete(item.key);imported.add(item.key);errors.delete(item.key);}
        catch(error){failed++;errors.set(item.key,error.message);if(error.code==='higgsfield_session_rejected')recovery(error);}
      }
      notice(`${success}개 가져왔습니다.${failed?` ${failed}개는 가져오지 못했습니다. 목록의 오류를 확인해 주세요.`:' 현재 작업의 파일 목록에서 확인하고 채팅으로 편집을 요청하세요.'}`);
      if(current())await refreshJob();await refreshState();
    }finally{importing=false;renderList();}
  }
  async function reconnect(button){
    // Open synchronously so browsers do not block the authorization window after awaiting the API.
    const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
    button.disabled=true;
    try{
      await api('POST','/api/hf/logout');
      const {url}=await api('POST','/api/hf/login');
      if(tab)tab.location.href=url;else{notice('로그인 창이 차단됐습니다. 아래 버튼을 눌러 열어 주세요.');const a=document.createElement('a');a.textContent='힉스필드 로그인 창 열기';a.href=url;a.target='_blank';a.rel='noopener noreferrer';$('.hf-recovery').append(a);return;}
      notice('새 창에서 로그인·허용을 마쳐 주세요. 돌아오면 실제 영상 조회로 연결을 확인합니다.');
    }catch(error){tab?.close();notice(error.message);recovery(error);}finally{button.disabled=false;}
  }
  async function onLogin(event){if(closed)return;if(event.detail?.error){notice(event.detail.error);recovery({code:'higgsfield_session_rejected'});}else await load(true);}
  el.addEventListener('change',event=>{
    const input=event.target;if(!input.matches('input[type=checkbox]'))return;
    const item=cache[source].items.find(item=>item.key===input.value);if(!item)return;
    if(input.checked){if(selected.size>=16){input.checked=false;notice('한 번에 최대 16개까지 선택할 수 있습니다.');return;}selected.set(item.key,item);}else selected.delete(item.key);
    input.closest('.hf-row').classList.toggle('is-selected',input.checked);footer();
  });
  el.addEventListener('click',async event=>{
    if(event.target===el){close();return;}
    const button=event.target.closest('button');if(!button||button.disabled)return;
    const action=button.dataset.hf;
    try{
      if(action==='close')close();
      if(action==='more')await load();
      if(action==='refresh')await load(true);
      if(action==='clear'){selected.clear();renderList();}
      if(action==='import')await importSelected();
      if(action==='connectors'){close();openConnectors();}
      if(action==='upload'){close();upload();}
      if(action==='login')await reconnect(button);
      if(action==='check'){button.disabled=true;try{await api('POST','/api/hf/check');await refreshState();await load(true);}finally{button.disabled=false;}}
      if(action==='update'){button.disabled=true;await api('POST','/cloud/restart');location.reload();}
      if(button.dataset.source){source=button.dataset.source;preview=null;$('.hf-player').innerHTML='';$('.hf-detail').innerHTML='<p>목록에서 영상을 눌러 미리보세요.</p>';for(const b of el.querySelectorAll('[data-source]')){const active=b.dataset.source===source;b.setAttribute('aria-pressed',String(active));b.classList.toggle('ghost',!active);}if(cache[source].loaded){notice(`${cache[source].items.length}개 표시`);renderList();if(cache[source].items.length)showPreview(cache[source].items[0]);}else await load();}
      if(button.dataset.preview)showPreview(cache[source].items.find(item=>item.key===button.dataset.preview));
    }catch(error){notice(error.message);recovery(error);}
  });
  el.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();close();}
    if(event.key==='Tab'){const nodes=[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),video,a')].filter(node=>node.getClientRects().length);if(!nodes.length)return;const edge=event.shiftKey?nodes[0]:nodes.at(-1),next=event.shiftKey?nodes.at(-1):nodes[0];if(document.activeElement===edge){event.preventDefault();next.focus();}}
  });
  document.body.append(el);$('[data-hf=close]').focus();window.addEventListener('mudex-hf-changed',onLogin);load();
}
