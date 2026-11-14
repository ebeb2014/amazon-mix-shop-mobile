import './scanner.js';
import {createClient} from '@supabase/supabase-js';
const $=id=>document.getElementById(id);
const cfg=window.AMS_CONFIG;
const client=createClient(cfg.supabaseUrl,cfg.publishableKey,{auth:{storageKey:'ams-live-session-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
let identity=null,checking=null,generation=0;
const problem=error=>{
  if(error?.code==='40001')return new Error('Datele s-au schimbat pe alt telefon. Reîncarcă pagina înainte să salvezi.');
  if(error?.code==='42501')return new Error('Contul nu are permisiunea necesară în magazin.');
  if(error?.code==='22023'||error?.code==='23514')return new Error('Verifică datele și cantitățile disponibile.');
  return new Error(error?.message||'Conexiunea cu magazinul nu a reușit.');
};
function signedOut(message=''){
  generation++;identity=null;
  document.body.classList.add('signed-out');
  $('login-progress').textContent='';$('login-error').textContent=message;$('login-error').hidden=!message;
  $('account-label').textContent='';
  window.dispatchEvent(new Event('ams:signed-out'));
}
async function verifyIdentity(){
  if(checking)return checking;
  const epoch=generation;
  checking=(async()=>{
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user)throw new Error('Conectează-te cu contul din magazin.');
    const result=await client.from('ams_app_users').select('user_id,owner_id,display_name,username,active').eq('user_id',user.id).maybeSingle();
    if(result.error)throw problem(result.error);
    if(!result.data?.active)throw new Error('Contul nu este activ în Amazon Mix Shop.');
    const permission=await client.rpc('ams_live_api',{p_action:'identity',p_data:{}});
    if(permission.error)throw problem(permission.error);
    if(epoch!==generation)return;
    identity={...result.data,...permission.data};
    $('account-label').textContent=identity.display_name||identity.username||'Cont magazin';
    $('login-progress').textContent='';$('login-error').hidden=true;
    document.body.classList.remove('signed-out');
    window.dispatchEvent(new Event('ams:signed-in'));
  })().finally(()=>{checking=null;});
  return checking;
}
async function rpc(name,params={}){
  if(!identity)throw new Error('Conectează-te cu contul din magazin.');
  const {data,error}=await client.rpc(name,params);
  if(error)throw problem(error);
  return data;
}
window.amsBackend={
  get ready(){return !!identity;},
  get identity(){return identity;},
  team:(action,data={})=>rpc('ams_live_team_api',{p_action:action,p_data:data}),
  call:(action,data={})=>rpc('ams_live_api',{p_action:action,p_data:data}),
  gls:(action,data={})=>rpc('ams_live_gls',{p_action:action,p_data:data}),
  async glsRequest(body){
    if(!identity)throw new Error('Conectează-te din nou.');
    const {data,error}=await client.functions.invoke('ams-live-gls',{body});
    if(error){let detail;try{detail=await error.context?.json();}catch{}throw new Error(detail?.error||error.message);}
    if(data?.error)throw new Error(data.error);return data;
  },
  async enablePush(){
    if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator))throw new Error('Notificările nu sunt disponibile aici. Pe iPhone deschide aplicația instalată.');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Permite notificările din setările telefonului pentru această aplicație.');
    const config=await rpc('ams_live_push',{p_action:'config',p_data:{}});
    if(!config?.publicKey)throw new Error('Notificările nu sunt configurate încă.');
    const registration=await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await rpc('ams_live_push',{p_action:'subscribe',p_data:subscription.toJSON()});
  },
  async photos(paths){
    if(!paths?.length)return [];
    const {data,error}=await client.storage.from('ams-live-products').createSignedUrls(paths,300);
    if(error)throw problem(error);return data.map(x=>x.signedUrl).filter(Boolean);
  },
  async upload(productId,file){
    if(!identity)throw new Error('Conectează-te din nou.');
    if(file.size>8388608)throw new Error('Fotografia trebuie să aibă cel mult 8 MB.');
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
    if(!ext)throw new Error('Alege o fotografie JPG, PNG sau WebP.');
    const path=identity.owner_id+'/'+productId+'/'+crypto.randomUUID()+'.'+ext;
    const {error}=await client.storage.from('ams-live-products').upload(path,file,{upsert:false,contentType:file.type});
    if(error)throw problem(error);return path;
  },
  async createUser(body){
    const {data,error}=await client.functions.invoke('ams-admin-users',{body:{action:'create',...body}});
    if(error||data?.error)throw problem(error||data);return data;
  },
  load:()=>rpc('ams_live_get_state'),
  save:({revision,state})=>rpc('ams_live_save_state',{p_revision:revision,p_state:state}),
  async catalog(){
    const products=[];
    let after=0;
    for(let page=0;page<100;page++){
      const rows=await rpc('ams_live_catalog',{p_after:after});
      if(!Array.isArray(rows))throw new Error('Stocul nu poate fi verificat.');
      products.push(...rows);
      if(rows.length<1000)return {products,fetchedAt:new Date().toISOString(),mode:'read-only'};
      after=Number(rows.at(-1).id);
    }
    throw new Error('Stocul este prea mare pentru o singură încărcare.');
  }
};
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('login-submit').disabled=true;$('login-error').hidden=true;
  $('login-progress').textContent='Se conectează…';
  try{
    const {error}=await client.auth.signInWithPassword({email:$('login-email').value.trim(),password:$('login-password').value});
    $('login-password').value='';
    if(error)throw new Error(error.code==='invalid_credentials'?'Emailul sau parola nu sunt corecte.':error.message);
    await verifyIdentity();
  }catch(error){signedOut(error.message);}
  finally{$('login-submit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  signedOut();
  // Remove this device's subscription while its session is still authenticated.
  try {
    const registration=await navigator.serviceWorker?.getRegistration('./');
    const subscription=await registration?.pushManager.getSubscription();
    if(subscription){await client.rpc('ams_live_push',{p_action:'disable',p_data:{endpoint:subscription.endpoint}});await subscription.unsubscribe();}
  } catch { /* Sign-out remains available if the network is down. */ }
  await client.auth.signOut({scope:'local'});
});
client.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){signedOut();return;}
  // Supabase calls listeners under its auth lock; verify outside that callback.
  if((event==='SIGNED_IN'||event==='TOKEN_REFRESHED')&&session&&(!identity||identity.user_id!==session.user.id)){
    setTimeout(()=>verifyIdentity().catch(error=>signedOut(error.message)),0);
  }
});
try{
  const {data:{session},error}=await client.auth.getSession();
  if(error)throw error;
  if(session)await verifyIdentity();else signedOut();
}catch(error){signedOut(navigator.onLine?'Conectează-te pentru a continua.':'Conectează-te la internet pentru a deschide aplicația.');}
