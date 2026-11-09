const $=s=>document.querySelector(s),form=$('#issue'),message=$('#message');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dollars=value=>Number(value??0).toFixed(2);
let codes=[];
async function call(path,method='GET',body) {
  const r=await fetch('/cloud/instructor/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await r.json();
  if(r.status===401){location.href='/instructor/login';throw new Error('강사로 다시 입장해 주세요.');}
  if(!r.ok)throw new Error(result.error??'요청을 처리하지 못했습니다.');return result;
}
const expired=c=>Date.parse(c.expires_at)<=Date.now();
const usable=c=>!c.disabled&&!expired(c)&&Number(c.spent_usd)<Number(c.budget_usd);
async function load(){
  ({codes}=await call('codes'));
  $('#summary').textContent=`전체 ${codes.length}개 · 사용 가능 ${codes.filter(usable).length}개`;
  $('#codes').innerHTML=codes.map(c=>`<tr><td>${esc(c.label)}</td><td><code>${esc(c.code)}</code></td><td>$${dollars(c.spent_usd)} / $${dollars(c.budget_usd)}</td><td>${esc(new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(c.expires_at)))}</td><td class="status">${c.disabled?'중지됨':expired(c)?'만료됨':Number(c.spent_usd)>=Number(c.budget_usd)?'한도 소진':'사용 가능'}</td><td><div class="actions" data-code="${esc(c.code)}"><button data-action="open" ${!c.disabled&&!expired(c)?'':'disabled'}>작업실 열기</button><button data-action="copy">복사</button><button class="stop" data-action="disable" ${c.disabled?'disabled':''}>중지</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">아직 발급한 코드가 없습니다. 위에서 코드를 발급해 주세요.</td></tr>';
}
form.elements.until.value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(Date.now()+7*864e5));
form.addEventListener('input',()=>{$('#total').textContent=`총 한도 $${dollars(Number(form.elements.count.value)*Number(form.elements.budget.value))} · 발급 자체에는 비용이 들지 않습니다.`;});
form.addEventListener('submit',async e=>{
  e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;message.textContent='코드를 발급하고 있습니다.';
  try {
    const result=await call('codes','POST',{label:form.elements.label.value,count:Number(form.elements.count.value),budget_usd:Number(form.elements.budget.value),expires_at:new Date(form.elements.until.value+'T23:59:59+09:00').toISOString()});
    await load();message.textContent=`${result.codes.length}개 코드를 발급했습니다.`;
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
$('#codes').addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button)return;const code=button.closest('[data-code]').dataset.code;
  button.disabled=true;
  try {
    if(button.dataset.action==='copy'){await navigator.clipboard.writeText(code);message.textContent='코드를 복사했습니다.';}
    if(button.dataset.action==='disable'&&confirm('이 연수생 코드를 중지할까요?')){await call('disable','POST',{code});await load();message.textContent='코드를 중지했습니다.';}
    if(button.dataset.action==='open') {
      const r=await fetch('/cloud/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});const result=await r.json();if(!r.ok)throw new Error(result.error??'작업실을 열지 못했습니다.');localStorage.removeItem('mudex.job');location.href='/';
    }
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
$('#copy-all').onclick=async()=>{try{await navigator.clipboard.writeText(codes.filter(usable).map(c=>`${c.label}\t${c.code}`).join('\n'));message.textContent='사용 가능한 코드를 복사했습니다.';}catch{message.textContent='복사 권한을 확인해 주세요.';}};
$('#refresh').onclick=()=>load().catch(e=>{message.textContent=e.message;});
$('#logout').onclick=async()=>{await call('logout','POST');location.href='/instructor/login';};
load().catch(error=>{message.textContent=error.message;});
