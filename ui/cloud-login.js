const form=document.querySelector('#login'),button=form.querySelector('button'),error=document.querySelector('#error');
form.addEventListener('submit',async event=>{
  event.preventDefault();button.disabled=true;button.textContent='작업실을 확인하고 있습니다…';error.textContent='';
  try {
    const response=await fetch('/cloud/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:form.elements.code.value})});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error ?? '입장하지 못했습니다.');
    localStorage.removeItem('mudex.job');location.href='/';
  }catch(e){error.textContent=e.message;button.disabled=false;button.textContent='작업실 열기 →';}
});
