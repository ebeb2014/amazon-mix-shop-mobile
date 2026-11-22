(() => {
 'use strict';
 const ui=()=>window.amsLiveUI, backend=()=>window.amsBackend;
 let generation=0;
 const role=()=>backend().identity?.role;
 async function settings() {
  const g=generation;
  const config=await backend().gls('status');
  if(g!==generation||!backend().ready||location.hash!=='#curier')return;
  const {h,btn}=ui();
  document.getElementById('title').textContent='GLS · AWB și etichete';
  document.getElementById('subtitle').textContent='Contul MyGLS al magazinului';
  document.getElementById('metrics').hidden=true;document.getElementById('actions').innerHTML='';
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#curier'));
  document.getElementById('content').innerHTML=`<article class="order-card"><h2>${config.connected?'Cont GLS conectat':'Conectează MyGLS'}</h2><p>${config.connected?(config.mode==='test'?'MEDIU DE TEST · etichetele nu se folosesc la livrare':'Cont real · expedieri conform contractului GLS'):'Ai nevoie de emailul și parola MyGLS, codul de client din contract și adresa de ridicare.'}</p>${backend().identity.primary_admin?btn(config.connected?'Modifică / verifică setările':'Conectează contul GLS','gls-config'):'<p>Administratorul principal configurează contul.</p>'}</article><article class="order-card"><h3>Cum generezi AWB-ul</h3><p>Fă comanda, apasă „Expediază” și generează AWB-ul. Pe calculator preiei aceeași comandă în bon, fără să introduci din nou produsele.</p><p>Confirmi strada, numărul, greutatea, data ridicării și suma ramburs. Eticheta PDF poate fi descărcată și imprimată. Configurarea nu creează expedieri.</p></article>`;
 }
 async function configure() {
  const ctx=ui().context(),g=generation;
  const status=await backend().gls('status');if(g!==generation||ctx!==ui().context())return;
  const c=status.settings||{},a=c.PickupAddress||{}, {field,form}=ui();
  form('Conectare MyGLS', `<p>Parola este trimisă securizat către server pentru conectarea GLS. Nu este salvată pe telefon și nu va fi afișată ulterior.</p>
   ${field('Username','Email MyGLS',c.Username,'email','required autocomplete="off" maxlength="254"')}
   ${field('password','Parolă MyGLS','','password','required autocomplete="new-password" maxlength="1000"')}
   ${field('ClientNumber','Cod client GLS din contract',c.ClientNumber,'number','required min="1" step="1"')}
   <h3>Adresa de ridicare a magazinului</h3>
   ${field('Name','Nume firmă / expeditor',a.Name,'text','required maxlength="160"')}
   ${field('Street','Stradă',a.Street,'text','required maxlength="200"')}
   ${field('HouseNumber','Număr (doar cifre)',a.HouseNumber,'text','required pattern="[0-9]+" maxlength="20"')}
   ${field('HouseNumberInfo','Bloc / scară / alte detalii',a.HouseNumberInfo,'text','maxlength="200"')}
   ${field('City','Localitate',a.City,'text','required maxlength="100"')}
   ${field('ZipCode','Cod poștal',a.ZipCode,'text','required pattern="[0-9]{6}" maxlength="6"')}
   ${field('ContactName','Persoană de contact',a.ContactName,'text','required maxlength="160"')}
   ${field('ContactPhone','Telefon de contact',a.ContactPhone,'tel','required maxlength="30"')}
   <label>Format etichetă<select name="TypeOfPrinter"><option value="A4_2x2">PDF A4 · imprimantă obișnuită</option><option value="Thermo" ${c.TypeOfPrinter==='Thermo'?'selected':''}>PDF · imprimantă termică</option></select></label>
   <label>Mediu GLS<select name="mode"><option value="production">Cont real MyGLS România</option><option value="test" ${status.mode==='test'?'selected':''}>Cont separat de test GLS</option></select></label>`,async fd=>{
    const config={Username:fd.get('Username'),ClientNumber:Number(fd.get('ClientNumber')),mode:fd.get('mode'),TypeOfPrinter:fd.get('TypeOfPrinter'),PickupAddress:Object.fromEntries(['Name','Street','HouseNumber','HouseNumberInfo','City','ZipCode','ContactName','ContactPhone'].map(k=>[k,String(fd.get(k)||'').trim()]))};
    const password=String(fd.get('password'));document.querySelector('[name="password"]').value='';
    await backend().glsRequest({action:'save_config',config,password});await settings();ui().notice('Contul GLS a fost verificat și salvat.');
   },'Verifică și salvează contul');
 }
 async function order(id) {
  const g=generation,ctx=ui().context();
  const [o,job,config]=await Promise.all([backend().call('get',{id}),backend().gls('job',{id}),backend().gls('status')]);
  if(g!==generation||ctx!==ui().context()||!backend().ready)return;
  const {form,h,field,btn,money}=ui();
  if(!config.connected){form('GLS neconectat','<p>Administratorul principal trebuie să conecteze contul din meniul Curier.</p>');return;}
  if(job.state) {
   const labels={ready:'AWB creat',pending:'Cerere în curs',unknown:'Rezultat de verificat în GLS',rejected:'Cerere respinsă de GLS'};
   form('GLS · comanda #'+o.number,`<h3>${h(labels[job.state])}</h3>${job.state==='ready'&&o.status==='reserved'?'<p>AWB-ul este gata și poate fi tipărit acum, fără bon fiscal. Bonul se emite separat în aplicația desktop.</p>':''}${job.mode==='test'?'<p><b>TEST · Nu folosi eticheta la livrare.</b></p>':''}<p>${h(job.awb||job.message||'Nu genera manual încă un colet înainte de verificare.')}</p><p>Referință GLS: ${h(job.reference)}</p>${job.state==='ready'?btn('Imprimă AWB A4','gls-label',id):job.state==='rejected'?btn('Corectează și reia cererea respinsă','gls-reset',id):btn('Verifică în GLS / recuperează eticheta','gls-resolve',id)}<div id="gls-download"></div><p><label for="gls-local-pdf">Dacă PDF-ul descărcat este necentrat, alege-l aici ca să-l centrezi pe A4, fără bon fiscal:</label><input id="gls-local-pdf" type="file" accept="application/pdf,.pdf"></p><p id="gls-local-status" role="status"></p>`);return;
  }
  if(!['reserved','paid'].includes(o.status)||!['new','packing','packed'].includes(o.fulfillment)||o.delivery!=='curier'||o.awb){form('AWB · comanda #'+o.number,'<p>Pentru a crea AWB fără bon fiscal, salvează și rezervă comanda cu livrare prin curier. Nu este necesar bonul. O comandă anulată, expediată sau returnată nu poate primi alt AWB.</p>');return;}
  const remaining=ui().remaining(o.goods_total,o.advance);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  form('Expediază · comanda #'+o.number,`${config.mode==='test'?'<p><b>MEDIU DE TEST</b></p>':'<p>Se va crea o expediere reală în contul GLS, conform contractului tău.</p>'}<h3>${h(o.customer.name)}</h3><p>${h(o.customer.phone)} · ${h(o.customer.address)} · ${h(o.customer.city)} · ${h(o.customer.postal)}</p><p>Verifică separarea străzii și a numărului pentru eticheta GLS.</p>
   ${field('postal','Cod poștal destinatar',o.customer.postal,'text','required pattern="[0-9]{6}" maxlength="6"')}
   ${field('street','Stradă (fără număr)','','text','required maxlength="200"')}
   ${field('house','Număr (doar cifre)','','text','required pattern="[0-9]+" maxlength="20"')}
   ${field('address_extra','Bloc / scară / etaj / apartament','','text','maxlength="200"')}
   ${field('weight','Greutate colet (kg)','','number','required min="0.01" max="40" step="0.01"')}
   ${field('pickup_date','Data ridicării',today,'date','required')}
   <p><b>Ramburs GLS: ${money(remaining)}</b></p>
   <p class="hint">Valoarea produselor minus avansul înregistrat. Cumpărătorul plătește transportul separat.</p>`,async fd=>{
    const request={action:'create',id,revision:o.revision,...Object.fromEntries(fd),cod:remaining,weight:Number(fd.get('weight'))};
    try{const result=await backend().glsRequest(request);ui().notice('AWB GLS creat: '+result.awb);await order(id);}catch(error){ui().close();await order(id);const target=document.getElementById('form-error');target.textContent=error.message;target.hidden=false;}
   },'Confirmă expedierea GLS');
 }
 document.addEventListener('change',async event=>{
  if(event.target.id!=='gls-local-pdf')return;
  const file=event.target.files?.[0],status=document.getElementById('gls-local-status');
  if(!file||!status)return;
  status.textContent='Se centrează PDF-ul pe foaia A4...';
  try{
   const centered=await window.amsGLSA4.prepareFile(file);
   if(!status.isConnected){URL.revokeObjectURL(centered);return;}
   status.innerHTML=`<b>AWB centrat pe A4.</b> <a href="${centered}" download="GLS-AWB-centrat-A4.pdf">Descarcă PDF-ul centrat</a> · <a href="${centered}" target="_blank" rel="noopener noreferrer">Deschide pentru imprimare</a>`;
  }catch(error){status.textContent='Nu s-a putut centra PDF-ul: '+error.message;}
 });
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action^="gls-"]');if(!button)return;
  ui().run(async()=>{
   const context=ui().context(),id=button.dataset.id;button.disabled=true;
   try {
    if(button.dataset.action==='gls-config')await configure();
    if(button.dataset.action==='gls-order')await order(id);
    if(button.dataset.action==='gls-reset'){await backend().gls('reset_rejected',{id});if(context===ui().context())await order(id);}
    if(button.dataset.action==='gls-resolve'){await backend().glsRequest({action:'resolve',id});if(context===ui().context())await order(id);}
    if(button.dataset.action==='gls-label') {
     // Open the preview synchronously from the click, before the server request.
     const printWindow=window.open('about:blank','_blank');
     if(printWindow){
      printWindow.document.title='AWB GLS · imprimare A4';
      printWindow.document.body.textContent='Se pregătește eticheta GLS centrată pe A4...';
     }
     const target=document.getElementById('gls-download');
     if(target)target.textContent='Se descarcă AWB-ul și se centrează pe A4...';
     try {
      const response=await backend().glsRequest({action:'label_inline',id});
      if(!response?.pdf_base64)throw new Error('Serverul nu a trimis eticheta PDF GLS.');
      const centered=await window.amsGLSA4.prepareBase64(response.pdf_base64);
      if(context!==ui().context()){URL.revokeObjectURL(centered);if(printWindow&&!printWindow.closed)printWindow.close();return;}
      const filename='GLS-'+String(response.awb||id).replace(/[^0-9a-zA-Z-]/g,'')+'-centrat-A4.pdf';
      const opened=window.amsGLSA4.printPreview(printWindow,centered,filename);
      const container=document.getElementById('gls-download');
      if(container)container.innerHTML=`<p><b>AWB centrat pe A4, pregătit pentru imprimare.</b></p><p><a href="${centered}" download="${ui().h(filename)}">Descarcă PDF A4 centrat</a></p><p><a href="${centered}" target="_blank" rel="noopener noreferrer">Deschide PDF-ul în browser</a></p><p class="hint">${opened?'Previzualizarea de imprimare este în fereastra nouă.':'Browserul a blocat fereastra nouă. Deschide PDF-ul din linkul de mai sus și apasă Ctrl+P.'} Alege A4 portret și scară 100%. Nu este nevoie de bon fiscal.</p>`;
     }catch(error){
      if(printWindow&&!printWindow.closed)printWindow.close();
      if(target)target.textContent='Imprimarea directă nu a reușit: '+error.message+'. Poți folosi mai jos eticheta PDF descărcată.';
      throw error;
     }
    }
   }catch(error){if(context===ui().context()&&document.getElementById('modal').open){const target=document.getElementById('form-error');target.textContent=error.message;target.hidden=false;}else throw error;}finally{button.disabled=false;}
  });
 });
 window.amsGLS={settings};window.addEventListener('ams:signed-out',()=>{generation++;});
})();
