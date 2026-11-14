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
    const permission=await client.rpc('ams_permission_mode',{p_permission_code:'pos.sell'});
    if(permission.error)throw problem(permission.error);
    if(permission.data!=='allow')throw new Error('Pentru comenzi Live, contul are nevoie de permisiunea de vânzare „Permis”.');
    if(epoch!==generation)return;
    identity=result.data;
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
