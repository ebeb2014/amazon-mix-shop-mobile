(function client(){
const $ = id => document.getElementById(id);
const status = ['nouă','de verificat','pregătită','expediată','livrată','retur','anulată'];
const confirmed = o => ['pregătită','expediată','livrată','retur'].includes(o.status) && !(o.status==='retur' && o.restocked);
const active = o => !['retur','anulată'].includes(o.status);
const cash = n => Intl.NumberFormat('ro-RO',{style:'currency',currency:'RON'}).format(n);
const sum = (rows,field) => rows.reduce((n,o)=>n+o[field],0);
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap = s => s[0].toUpperCase()+s.slice(1);
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Bucharest'}).format(new Date());
const normal = s => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
let state, revision, edit, busy=false, authEpoch=0;
let query='', statusFilter='', liveFilter='';
const find = (list,id) => state[list].find(x=>x.id===id);
const reserved = id => state.orders.filter(o=>o.product===id&&confirmed(o)).reduce((n,o)=>n+o.qty,0);
const available = p => p.total-reserved(p.id);
const button = (label,action,id='',primary=false) => `<button type="button" data-action="${action}" data-id="${esc(id)}"${primary?' class="primary"':''}>${label}</button>`;
const options = (items,value) => items.map(([key,label])=>`<option value="${esc(key)}"${key===value?' selected':''}>${esc(label)}</option>`).join('');
const badge = s => `<span class="badge" data-status="${s}">${cap(s)}</span>`;
const info = (label,value) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`;
function announce(message='',error=false){
  $('notice').textContent=message;
  $('notice').hidden=!message;
  $('notice').classList.toggle('error',error);
}
async function api(method='GET',data){
  return method==='GET'?window.amsBackend.load():window.amsBackend.save(data);
}
async function load(){
  if(!window.amsBackend?.ready)return;
  const epoch=authEpoch;
  try {
    const result=await api();
    if(epoch!==authEpoch)return;
    ({state,revision}=result);
    announce();
    render();
  } catch(e){
    announce(e.message,true);
    $('content').innerHTML=button('Reîncearcă','reload');
  }
}
async function save(next){
  if(busy)return false;
  if(!navigator.onLine){announce('Nu ai internet. Reconectează-te înainte să salvezi.',true);return false;}
  const epoch=authEpoch;
  busy=true;
  $('editor').querySelector('[type=submit]').disabled=true;
  try{
    const result=await api('PUT',{revision,state:next});
    if(epoch!==authEpoch)return false;
    ({revision}=result);
    state=next;
    render();
    announce('Modificările au fost salvate.');
    return true;
  }catch(e){
    if($('modal').open){
      $('form-error').textContent=e.message;
      $('form-error').hidden=false;
    }else announce(e.message,true);
    return false;
  }finally{
    busy=false;
    $('editor').querySelector('[type=submit]').disabled=false;
  }
}
function empty(icon,title,description,action=''){
  return `<div class="empty"><span aria-hidden="true">${icon}</span><h2>${title}</h2><p class="muted">${description}</p>${action}</div>`;
}
function table(headers,rows){
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,i)=>`<td data-label="${headers[i]}">${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function render(){
  if(!state)return;
  const page=location.hash.slice(1);
  const current=['stoc','live','magazin'].includes(page)?page:'comenzi';
  document.querySelectorAll('nav a').forEach(a=>{
    if(a.hash==='#'+current)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });
  if(current==='magazin'){window.amsCatalog.open();return;}
  const meta={
    comenzi:['Comenzi','Urmărește comenzile primite în timpul live-urilor.','+ Comandă nouă','order'],
    stoc:['Stoc manual','Produse introduse în acest panou. Confirmările de aici nu rezervă stocul magazinului.','+ Produs nou','product'],
    live:['Sesiuni Live','Vezi comenzile și încasările pe fiecare sesiune.','+ Live nou','live']
  }[current];
  $('title').textContent=meta[0];
  $('subtitle').textContent=meta[1];
  $('actions').innerHTML=button(meta[2],meta[3],'',true);
  if(current==='comenzi'){
    const orders=state.orders.filter(o=>(!liveFilter||o.live===liveFilter)&&(!statusFilter||o.status===statusFilter));
    $('metrics').innerHTML=info('Comenzi',orders.length)+info('De verificat',orders.filter(o=>o.status==='de verificat').length)+info('Pregătite',orders.filter(o=>o.status==='pregătită').length)+info('De încasat',cash(sum(orders.filter(o=>active(o)&&o.status!=='livrată'),'amount')));
    $('content').innerHTML=`<div class="panel"><div class="bar"><h2>Lista comenzilor</h2><div class="filters"><input id="query" type="search" aria-label="Caută comenzi" placeholder="Caută client, telefon, produs…" value="${esc(query)}"><select id="status-filter" aria-label="Status">${options([['','Toate statusurile'],...status.map(s=>[s,cap(s)])],statusFilter)}</select><select id="live-filter" aria-label="Sesiune Live">${options([['','Toate sesiunile'],...state.lives.map(l=>[l.id,l.name])],liveFilter)}</select></div></div><div id="orders"></div></div>`;
    $('query').addEventListener('input',e=>{query=e.target.value;renderOrders();});
    $('status-filter').addEventListener('change',e=>{statusFilter=e.target.value;render();$('status-filter').focus();});
    $('live-filter').addEventListener('change',e=>{liveFilter=e.target.value;render();$('live-filter').focus();});
    renderOrders();
  }else if(current==='stoc'){
    $('metrics').innerHTML=info('Produse',state.products.length)+info('Unități disponibile',state.products.reduce((n,p)=>n+available(p),0))+info('Stoc epuizat',state.products.filter(p=>available(p)===0).length);
    $('content').innerHTML=`<div class="panel"><div class="bar"><h2>Inventar</h2></div>${state.products.length?table(['Produs','Disponibil','Alocat comenzilor','Acțiuni'],state.products.map(p=>[
      `<strong>${esc(p.name)}</strong>`,`<strong>${available(p)}</strong> buc.`,reserved(p.id)+' buc.',button('Corectează stocul','product',p.id)
    ])):empty('◇','Adaugă primul produs','Introdu numele produsului și cantitatea disponibilă.',button('Adaugă produs','product','',true))}</div>`;
  }else{
    $('metrics').innerHTML=info('Sesiuni Live',state.lives.length)+info('Comenzi din live-uri',state.orders.filter(o=>o.live).length);
    $('content').innerHTML=state.lives.length?`<div class="live-grid">${[...state.lives].sort((a,b)=>b.date.localeCompare(a.date)).map(l=>{
      const rows=state.orders.filter(o=>o.live===l.id);
      const currentRows=rows.filter(active);
      return `<article class="live-card"><h2>${esc(l.name)}</h2><p class="muted">${esc(l.date.split('-').reverse().join('.'))}</p>${l.notes?`<p class="hint">${esc(l.notes)}</p>`:''}<div class="live-stats"><div>Comenzi<strong>${rows.length}</strong></div><div>De încasat<strong>${cash(sum(currentRows.filter(o=>o.status!=='livrată'),'amount'))}</strong></div><div>Avansuri active<strong>${cash(sum(currentRows,'advance'))}</strong></div><div>Curier comenzi active<strong>${cash(sum(currentRows,'courier'))}</strong></div></div><div class="chips">${status.filter(s=>rows.some(o=>o.status===s)).map(s=>`<span class="badge" data-status="${s}">${cap(s)} · ${rows.filter(o=>o.status===s).length}</span>`).join('')}</div><div class="row-actions">${button('Vezi comenzi','live-orders',l.id)}${button('Comandă nouă','live-order',l.id)}${button('Duplică','duplicate-live',l.id)}${button('Editează','live',l.id)}</div></article>`;
    }).join('')}</div>`:`<div class="panel">${empty('◉','Pregătește primul live','Adaugă o sesiune pentru a grupa comenzile primite în acel live.',button('Adaugă sesiune','live','',true))}</div>`;
  }
}
function renderOrders(){
  const rows=state.orders.filter(o=>(!liveFilter||o.live===liveFilter)&&(!statusFilter||o.status===statusFilter)&&normal([o.customer,o.phone,o.city,find('products',o.product)?.name].join(' ')).includes(normal(query.trim())));
  $('orders').innerHTML=rows.length?table(['Client','Produs','Livrare','De încasat','Status','Acțiuni'],rows.map(o=>[
    `<strong>${esc(o.customer)}</strong><small><a href="tel:${esc(o.phone.replace(/[^+0-9]/g,''))}">${esc(o.phone)}</a> · ${esc(o.city)}</small>`,
    `<strong>${esc(find('products',o.product)?.name)}</strong><small>${o.qty} buc.${o.live?' · '+esc(find('lives',o.live)?.name):''}</small>`,
    `${esc(o.delivery)}<small>Curier ${cash(o.courier)}</small>`,`${cash(o.amount)}<small>Avans ${cash(o.advance)}</small>`,badge(o.status),
    `<div class="row-actions">${['nouă','de verificat'].includes(o.status)?button('Confirmă','confirm',o.id,true):''}${button('Editează','order',o.id)}${button('Duplică','duplicate-order',o.id)}${o.status==='retur'&&!o.restocked?button('Reintră în stoc','restock',o.id):''}</div>`
  ])):empty('▤',state.orders.length?'Nicio comandă găsită':'Încă nu ai comenzi',state.orders.length?'Schimbă căutarea sau filtrele pentru a vedea alte comenzi.':'Adaugă prima comandă primită pe TikTok Live.',state.orders.length?'':button('Adaugă comandă','order','',true));
}
const field=(label,name,value='',type='text',attrs='')=>`<label>${label}<input name="${name}" value="${esc(value)}" type="${type}" ${attrs}></label>`;
const select=(label,name,items,value)=>`<label>${label}<select name="${name}">${options(items,value)}</select></label>`;
const notes=(value='')=>`<label class="wide">Observații<textarea name="notes" rows="2" maxlength="1500">${esc(value)}</textarea></label>`;
function open(type,id='',mode=''){
  const list={order:'orders',product:'products',live:'lives'}[type];
  const old=find(list,id);
  if(type==='order'&&!state.products.length){
    announce('Adaugă întâi produsul în stoc. După salvare se deschide formularul comenzii.');
    open('product','','order-next');
    return;
  }
  edit={type,list,id:mode==='duplicate'?'':id,mode};
  let markup;
  if(type==='order'){
    const copy=mode==='duplicate';
    const o=old??{};
    $('dialog-title').textContent=copy?'Duplică modelul de comandă':old?'Editează comanda':'Comandă nouă';
    markup=select('Produs','product',state.products.map(p=>[p.id,p.name+' · '+available(p)+' disponibile']),o.product)
      +field('Cantitate','qty',o.qty??1,'number','required min="1" step="1"')
      +field('Client','customer',copy?'':o.customer,'text','required maxlength="150"')
      +field('Telefon','phone',copy?'':o.phone,'tel','required maxlength="35"')
      +field('Localitate','city',copy?'':o.city,'text','required maxlength="120"')
      +select('Metodă de livrare','delivery',[
        ['GLS','Curier GLS'],
        ...(!copy&&o.delivery==='Curier'?[['Curier','Curier (nespecificat)']]:[]),
        ['Ridicare din magazin','Ridicare din magazin'],
        ['Altă metodă','Altă metodă']
      ],copy&&o.delivery==='Curier'?'GLS':o.delivery??'GLS')
      +field('Cost curier (lei)','courier',o.courier??0,'number','required min="0" step="0.01"')
      +field('Sumă rămasă de încasat (lei)','amount',o.amount??0,'number','required min="0" step="0.01"')
      +field('Avans primit (lei)','advance',copy?0:o.advance??0,'number','required min="0" step="0.01"')
      +select('Status','status',status.map(s=>[s,cap(s)]),copy?'nouă':o.status??'nouă')
      +select('Sesiune Live','live',[['','Fără sesiune'],...state.lives.map(l=>[l.id,l.name])],o.live??liveFilter)
      +(o.restocked&&!copy?'<p class="wide hint">Returul a fost repus în stoc.</p>':'')+notes(copy?'':o.notes);
  }else if(type==='product'){
    $('dialog-title').textContent=old?'Corectează stocul':'Produs nou';
    markup=field('Nume produs','name',old?.name,'text','required maxlength="150"')+field('Cantitate disponibilă','available',old?available(old):0,'number','required min="0" step="1"');
    if(old)markup+='<p class="wide hint">Introdu câte bucăți sunt acum disponibile la vânzare.</p>';
  }else{
    const copy=mode==='duplicate';
    $('dialog-title').textContent=copy?'Duplică sesiunea Live':old?'Editează sesiunea':'Live nou';
    markup=field('Nume sesiune','name',copy?old.name+' – copie':old?.name,'text','required maxlength="150"')+field('Data','date',copy?today():old?.date??today(),'date','required')+notes(old?.notes);
  }
  $('fields').innerHTML=`<div class="fields-grid">${markup}</div>`;
  $('form-error').hidden=true;
  $('modal').showModal();
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-action]');
  if(!b||busy)return;
  const {action,id}=b.dataset;
  if(action==='reload')return load();
  if(action==='live-orders'){
    liveFilter=id;statusFilter='';query='';
    location.hash='comenzi';
    return render();
  }
  if(action==='live-order'){
    liveFilter=id;
    return open('order');
  }
  if(action==='confirm'||action==='restock'){
    const next=structuredClone(state);
    const o=next.orders.find(row=>row.id===id);
    if(action==='confirm'){
      if(available(find('products',o.product))<o.qty)return announce('Stoc insuficient pentru confirmarea acestei comenzi.',true);
      o.status='pregătită';
    }else{
      if(o.restocked)return;
      o.restocked=true;
    }
    return save(next);
  }
  if(action.startsWith('duplicate-'))return open(action.slice(10),id,'duplicate');
  open(action,id);
});
$('editor').addEventListener('submit',async e=>{
  e.preventDefault();
  if(busy)return;
  const values=Object.fromEntries(new FormData(e.target));
  const {type,list,id,mode}=edit;
  const old=find(list,id);
  const row={...old,...values,id:id||crypto.randomUUID()};
  if(type==='order'){
    for(const key of ['qty','courier','amount','advance'])row[key]=Number(row[key]);
    for(const key of ['customer','phone','city'])row[key]=row[key].trim();
    if(row.status!=='retur')row.restocked=false;
    const p=find('products',row.product);
    const freed=old?.product===row.product&&confirmed(old)?old.qty:0;
    if(confirmed(row)&&row.qty>available(p)+freed){
      $('form-error').textContent='Stoc insuficient pentru cantitatea selectată.';
      $('form-error').hidden=false;
      return;
    }
  }else{
    row.name=row.name.trim();
    if(type==='product'){
      row.total=Number(row.available)+reserved(row.id);
      delete row.available;
    }
  }
  const next=structuredClone(state);
  next[list]=id?next[list].map(item=>item.id===id?row:item):[row,...next[list]];
  if(await save(next)){
    $('modal').close();
    if(mode==='order-next')open('order');
  }
});
for(const id of ['cancel','close'])$(id).addEventListener('click',()=>{if(!busy)$('modal').close();});
$('modal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
window.addEventListener('hashchange',render);
window.addEventListener('ams:signed-in',()=>{authEpoch++;load();});
window.addEventListener('ams:signed-out',()=>{authEpoch++;state=null;revision=0;edit=null;busy=false;$('modal').close();$('content').replaceChildren();$('metrics').replaceChildren();$('fields').replaceChildren();announce();});
if(window.amsBackend?.ready)load();
})();
