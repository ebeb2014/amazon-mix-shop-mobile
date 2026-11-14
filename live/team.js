/* Team workflows share the authenticated session, never store customer data offline. */
(() => {
  'use strict';
  const ui = () => window.amsLiveUI;
  const backend = () => window.amsBackend;
  let generation = 0;
  async function call(action, data = {}) {
    const current = generation;
    const result = await backend().team(action, data);
    if (current !== generation || !backend().ready) throw new Error('Sesiunea s-a închis.');
    return result;
  }
  async function order(id) {
    const current = generation, context=ui().context();
    const [o, detail] = await Promise.all([backend().call('get', {id}), call('details', {id})]);
    if (current !== generation || !backend().ready || context!==ui().context()) return;
    const {h, btn, form} = ui();
    const canWork = ['manager', 'operator', 'packer'].includes(backend().identity.role);
    const canLink = ['manager', 'operator'].includes(backend().identity.role);
    const mine = detail.assigned_to === backend().identity.user_id;
    const checked = new Set(detail.checks.map(c => c.product_id));
    form('Pregătire · comanda #' + o.number, `
      <p><b>Responsabil:</b> ${h(detail.assigned_name || 'Nepreluată')}</p>
      <div class="detail-actions">${canWork && !detail.assigned_to ? btn('Preiau comanda','team-claim',id) : ''}
      ${canWork && (mine || backend().identity.role === 'manager') && detail.assigned_to ? btn('Eliberează responsabilul','team-release',id) : ''}</div>
      <h3>${checked.size} din ${o.items.length} bucăți verificate</h3>
      <div class="order-lines">${o.items.map(i => `<p>${checked.has(String(i.id)) ? '✓' : '○'} ${h(i.code)} · ${h(i.name)}</p>`).join('')}</div>
      ${mine && ['new','packing'].includes(o.fulfillment) ? `<label>Cod intern al bucății<input id="packing-code" autocomplete="off"></label><div class="detail-actions">${btn('Verifică acest cod','team-check',id)}${btn('Scanează cu camera','team-camera',id)}</div>` : ''}
      <p class="hint">Fiecare bucată se verifică prin codul intern de pe eticheta magazinului. EAN-ul poate fi comun mai multor bucăți.</p>
      ${canLink && ['draft','reserved'].includes(o.status) && ['new','packing'].includes(o.fulfillment) ? `<h3>Link pentru client</h3><p>Clientul vede produsele și completează adresa fără cont. Linkul expiră în 7 zile. Un link nou îl înlocuiește pe cel anterior.</p>${btn('Creează link client','team-link',id)}${detail.link_active ? btn('Revocă linkul','team-revoke',id) : ''}<div id="customer-link"></div>` : ''}
      <div class="detail-actions">${canWork?btn('AWB automat GLS','gls-order',id):''}${btn('Înapoi la comandă','order',id)}</div>`);
  }
  async function mutation(action, id, extra = {}) {
    const o = await backend().call('get', {id});
    return call(action, {id, revision:o.revision, ...extra});
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action^="team-"]');
    if (!button) return;
    ui().run(async () => {
      button.disabled = true;
      const id = button.dataset.id, context=ui().context();
      const reopen=()=>context===ui().context()?order(id):undefined;
      try {
        switch (button.dataset.action) {
          case 'team-order': await order(id); break;
          case 'team-claim': await mutation('claim', id); await reopen(); break;
          case 'team-release': await mutation('release', id); await reopen(); break;
          case 'team-check': await mutation('scan', id, {code:document.getElementById('packing-code').value}); await reopen(); break;
          case 'team-camera': window.amsScan(code => ui().run(async () => {await mutation('scan',id,{code}); await reopen();})); break;
          case 'team-link': {
            const result = await mutation('link_create',id);
            const url = new URL('client.html',location.href); url.hash=result.token;
            if(context!==ui().context())return;
            const target = document.getElementById('customer-link');
            if (!target) return;
            target.innerHTML=`<label>Trimite acest link doar clientului<input id="share-customer-link" readonly value="${ui().h(url.href)}"></label><button type="button" data-action="team-copy">Copiază linkul</button>`;
            break;
          }
          case 'team-copy': await navigator.clipboard.writeText(document.getElementById('share-customer-link').value); ui().notice('Link copiat.'); break;
          case 'team-revoke': await mutation('link_revoke',id); await reopen(); break;
          case 'team-read': await call('read_events'); await render('notificari'); break;
          case 'team-push': await backend().enablePush(); ui().notice('Notificările sunt activate pe acest dispozitiv.'); break;
        }
      } catch(error) {
        if(context===ui().context()&&document.getElementById('modal').open){const target=document.getElementById('form-error');target.textContent=error.message;target.hidden=false;}else throw error;
      } finally {button.disabled=false;}
    });
  });
  const titles = {notificari:'Notificările echipei',rapoarte:'Rezumat pe sesiune Live','rezervari-vechi':'Rezervări mai vechi de 24 de ore',curier:'Conectarea curierului'};
  async function render(page) {
    if(page==='curier'){await window.amsGLS.settings();return;}
    const current=generation;
    const {h,btn,money}=ui();
    document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+page));
    document.getElementById('title').textContent=titles[page];
    document.getElementById('subtitle').textContent='Amazon Mix Shop · echipă și livrări';
    document.getElementById('metrics').hidden=true;
    document.getElementById('actions').innerHTML='';
    const content=document.getElementById('content');
    content.textContent='Se încarcă…';
    let html='';
    if(page==='rapoarte') {
      const rows=await call('reports');
      html=`<p class="hint">Sunt incluse toate comenzile fiecărei sesiuni. Valoarea exclude anulările și include transportul; nu reprezintă încasări confirmate.</p><div class="order-grid">${rows.map(r=>`<article class="order-card"><h2>${h(r.name)}</h2><p>${r.orders} comenzi · <b>${money(r.total)}</b></p><p>${r.reserved} rezervări · ${r.cancelled} anulări · ${r.unshipped} neexpediate</p></article>`).join('')}</div>`;
    } else if(page==='notificari') {
      const data=await call('events');
      html=`<div class="detail-actions">${btn('Marchează citite ('+data.unread+')','team-read')}${btn('Activează notificările pe acest telefon','team-push')}</div><p class="hint">Pe iPhone, deschide aplicația instalată pe ecranul principal pentru a permite notificările.</p>${data.events.map(e=>`<article class="order-card"><h3>${h(e.title)}</h3><p>${h(new Date(e.created_at).toLocaleString('ro-RO'))}</p>${btn('Deschide comanda','order',e.order_id)}</article>`).join('') || '<p>Nicio notificare încă.</p>'}`;
    } else if(page==='rezervari-vechi') {
      const rows=await call('stale');
      html='<p class="hint">Contactează clientul înainte de anulare. Rezervările nu se anulează automat. Se afișează cele mai vechi 500.</p>'+ (rows.map(o=>`<article class="order-card"><h3>#${o.number} · ${h(o.customer.name)}</h3><p>${h(o.customer.phone)}</p>${btn('Deschide comanda','order',o.id)}</article>`).join('') || '<p>Nu sunt rezervări mai vechi de 24 de ore.</p>');
    } else {
      html='<article class="order-card"><h2>Curier neconectat</h2><p>Pentru AWB automat este necesar contul de curier al magazinului. Nu a fost configurat încă un furnizor.</p><p>Până la conectare, creează AWB-ul în contul curierului și introdu numărul în „Pregătire / AWB”. Nu sunt generate expedieri sau taxe automat.</p></article>';
    }
    if(current===generation && backend().ready && location.hash==='#'+page) content.innerHTML=html;
  }
  window.amsTeam={route(page){if(!titles[page])return false;ui().run(()=>render(page));return true;}};
  window.addEventListener('ams:signed-out',()=>{generation++;});
})();
