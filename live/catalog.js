(function catalog(){
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=v=>String(v??'').toLocaleLowerCase('ro').normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const money=v=>v===null?'Preț nesetat':new Intl.NumberFormat('ro-RO',{style:'currency',currency:'RON'}).format(v);
  let data=null, loading=false, error='', query='', filter='available', page=0;
  const pageSize=40;
  const active=()=>location.hash==='#magazin'&&!!window.amsBackend?.ready;
  let authEpoch=0;
  function renderRows(){
    if(!active()||!$('catalog-rows'))return;
    const rows=(data?.products||[]).filter(p=>(filter!=='available'||p.available)&&normalize([p.name,p.code,p.ean].join(' ')).includes(normalize(query.trim())));
    const pages=Math.max(1,Math.ceil(rows.length/pageSize));
    page=Math.min(page,pages-1);
    $('catalog-count').textContent=rows.length===1?'1 produs găsit':rows.length+' produse găsite';
    $('catalog-pagination').hidden=rows.length<=pageSize;
    $('catalog-page').textContent=`Pagina ${page+1} din ${pages}`;
    $('catalog-prev').disabled=page===0;
    $('catalog-next').disabled=page>=pages-1;
    $('catalog-rows').innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th scope="col">Produs</th><th scope="col">Cod magazin</th><th scope="col">Preț</th><th scope="col">Disponibilitate</th></tr></thead><tbody>${rows.slice(page*pageSize,(page+1)*pageSize).map(p=>`<tr><td data-label="Produs"><strong>${esc(p.name)}</strong>${p.ean?`<small>EAN ${esc(p.ean)}</small>`:''}</td><td data-label="Cod magazin"><span class="product-code">${esc(p.code)}</span></td><td data-label="Preț">${money(p.price)}</td><td data-label="Disponibilitate"><span class="badge" data-status="${p.available?'livrată':'de verificat'}">${p.available?'Disponibil · 1 buc.':'Rezervat la casă'}</span></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h2>Niciun produs găsit</h2><p class="muted">Schimbă numele, codul sau filtrul de disponibilitate.</p></div>';
  }
  function render(){
    if(!active())return;
    $('title').textContent='Stoc magazin';
    $('subtitle').textContent='Produsele din gestiunea magazinului, cu preț și cod individual.';
    $('actions').innerHTML='<button type="button" id="refresh-catalog" class="primary">Actualizează</button>';
    $('refresh-catalog').disabled=loading;
    $('refresh-catalog').textContent=loading?'Se verifică…':'Actualizează';
    $('refresh-catalog').onclick=refresh;
    const available=(data?.products||[]).filter(p=>p.available).length;
    $('metrics').innerHTML=data?`<div class="metric"><small>Disponibile în magazin</small><strong>${available}</strong></div><div class="metric"><small>Rezervate la casă</small><strong>${data.products.length-available}</strong></div><div class="metric"><small>Ultima verificare</small><strong>${new Intl.DateTimeFormat('ro-RO',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Bucharest'}).format(new Date(data.fetchedAt))}</strong></div>`:'';
    $('content').innerHTML='<p class="connection-note"><b>Stoc conectat · doar consultare.</b> Rezervarea online și trimiterea comenzii la casa de marcat nu sunt încă activate. Comenzile din panou folosesc stocul introdus manual.</p>'+
      (error?`<div class="catalog-error" role="alert">${esc(error)}<p>Disponibilitatea nu poate fi confirmată până la următoarea verificare reușită.</p></div>`:
      !data?'<div class="panel empty" role="status"><p>Se citește stocul magazinului…</p></div>':
      `<div class="panel"><div class="bar"><h2 id="catalog-count"></h2><div class="filters"><input id="catalog-query" type="search" placeholder="Nume, cod magazin sau EAN…" aria-label="Caută în stocul magazinului" value="${esc(query)}"><select id="catalog-filter" aria-label="Disponibilitate"><option value="available"${filter==='available'?' selected':''}>Doar disponibile</option><option value="all"${filter==='all'?' selected':''}>Disponibile și rezervate</option></select></div></div><div id="catalog-rows"></div><div id="catalog-pagination" class="catalog-pagination"><button id="catalog-prev" type="button">← Înapoi</button><span id="catalog-page" aria-live="polite"></span><button id="catalog-next" type="button">Înainte →</button></div></div><p class="hint">Fiecare rând reprezintă o bucată. Stocul se verifică automat la un minut cât timp această pagină este deschisă.</p>`);
    if(data&&!error){
      $('catalog-query').oninput=e=>{query=e.target.value;page=0;renderRows();};
      $('catalog-filter').onchange=e=>{filter=e.target.value;page=0;renderRows();};
      $('catalog-prev').onclick=()=>{page--;renderRows();};
      $('catalog-next').onclick=()=>{page++;renderRows();};
      renderRows();
    }
  }
  async function refresh(){
    if(loading||!window.amsBackend?.ready)return;
    const epoch=authEpoch;
    loading=true;error='';
    if(data&&active()&&$('refresh-catalog')){$('refresh-catalog').disabled=true;$('refresh-catalog').textContent='Se verifică…';}
    else render();
    try{
      if(!navigator.onLine)throw new Error('Conexiunea la internet lipsește.');
      const next=await window.amsBackend.catalog();
      if(epoch!==authEpoch)return;
      data=next;
    }catch(e){data=null;error=e.message||'Stocul nu poate fi verificat acum.';}
    finally{
      loading=false;
      const focused=document.activeElement?.id;
      const selection=$('catalog-query')?.selectionStart;
      render();
      if(active()&&focused==='catalog-query'&&$('catalog-query')){$('catalog-query').focus();$('catalog-query').setSelectionRange(selection,selection);}
    }
  }
  window.addEventListener('ams:signed-out',()=>{authEpoch++;data=null;query='';filter='available';page=0;error='';});
  window.amsCatalog={open:()=>{render();refresh();}};
  setInterval(()=>{if(active()&&!document.hidden)refresh();},60000);
  document.addEventListener('visibilitychange',()=>{if(active()&&!document.hidden)refresh();});
  window.addEventListener('online',()=>{if(active())refresh();});
  window.addEventListener('offline',()=>{data=null;error='Conexiunea la internet lipsește.';render();});
})();
