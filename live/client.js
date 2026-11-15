(() => {
  'use strict';
  const token=location.hash.slice(1);
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>new Intl.NumberFormat('ro-RO',{style:'currency',currency:'RON'}).format(v);
  const message=document.getElementById('message'),form=document.getElementById('customer-form');
  let revision;
  async function request(customer=null){
    const r=await fetch(window.AMS_CONFIG.supabaseUrl+'/rest/v1/rpc/ams_live_customer',{method:'POST',headers:{apikey:window.AMS_CONFIG.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:token,p_customer:customer,p_revision:revision??null}),cache:'no-store'});
    const data=await r.json();if(!r.ok)throw new Error(data.message||'Comanda nu poate fi deschisă.');return data;
  }
  async function load(){
    try{
      const data=await request();revision=data.revision;
      document.getElementById('summary').innerHTML=`<h2>Comanda #${data.number}</h2>${data.items.map(i=>`<p>${h(i.name)} · ${money(i.price)}</p>`).join('')}<p><b>Produse: ${money(data.items.reduce((sum,item)=>sum+Number(item.price),0))}</b></p><p>Avans înregistrat: ${money(data.advance)}</p>`;
      const fields={name:['Nume complet',160],phone:['Telefon',30],address:['Stradă, număr, bloc, apartament',500],city:['Localitate',100],county:['Județ / sector',100],postal:['Cod poștal',20]};
      form.innerHTML=Object.entries(fields).map(([key,[label,max]])=>`<label>${label}<input name="${key}" maxlength="${max}" ${key==='postal'?'':'required'} value="${h(data.customer[key])}"></label>`).join('')+'<button class="primary" type="submit">Confirmă datele de livrare</button>';
      form.hidden=false;message.textContent='Link personal. Nu îl distribui altor persoane.';
    }catch(error){message.textContent=error.message;}
  }
  form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const data=await request(Object.fromEntries(new FormData(form)));revision=data.revision;message.textContent='Datele au fost salvate. Mulțumim!';}catch(error){message.textContent=error.message;}finally{button.disabled=false;}});
  load();
})();
