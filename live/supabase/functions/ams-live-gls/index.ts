import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {glsDate,labelBytes,matchingParcel,validateSettings} from './protocol.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors={'Access-Control-Allow-Origin':'https://ebeb2014.github.io','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
async function call(client,name,action,data={}) {
 const r=await client.rpc(name,{p_action:action,p_data:data});if(r.error)throw new Error(r.error.message);return r.data;
}
async function carrier(config,method,body) {
 const host=config.mode==='test'?'api.test.mygls.ro':'api.mygls.ro';
 const response=await fetch(`https://${host}/ParcelService.svc/json/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({Username:config.Username,Password:config.Password,WebshopEngine:'Amazon Mix Shop',...body}),signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!response.ok)throw new Error(`GLS a răspuns cu HTTP ${response.status}. Verifică accesul MyGLS.`);
 return response.json();
}
function errors(result,key){return (result[key]||[]).map(e=>`GLS ${e.ErrorCode}: ${e.ErrorDescription||'Cerere respinsă'}`).join('; ').slice(0,500);}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Metodă invalidă'},405);
 try {
  const bearer=req.headers.get('Authorization')||'';
  const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}},auth:{persistSession:false}});
  const user=await client.auth.getUser();if(user.error||!user.data.user)return reply({error:'Conectează-te din nou.'},401);
  const identity=await call(client,'ams_live_api','identity');
  const body=await req.json();if(JSON.stringify(body).length>20000)throw new Error('Cerere prea mare.');
  const owner_id=identity.owner_id;
  const rpc=(action,data={})=>call(client,'ams_live_gls',action,data);
  const worker=(action,data={})=>call(service,'ams_live_gls_worker',action,{owner_id,...data});
  if(body.action==='save_config') {
   if(!identity.primary_admin)throw new Error('Doar administratorul principal poate conecta GLS.');
   let config=validateSettings(body.config);
   if(typeof body.password!=='string'||body.password.length<1||body.password.length>1000)throw new Error('Introdu parola MyGLS.');
   config.Password=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512',new TextEncoder().encode(body.password))));
   const now=Date.now();
   const check=await carrier(config,'GetParcelList',{PrintDateFrom:glsDate(now-3600000),PrintDateTo:glsDate(now)});
   const problem=errors(check,'GetParcelListErrors');if(problem)throw new Error(problem);
   if(!Array.isArray(check.PrintDataInfoList))throw new Error('Răspuns MyGLS neașteptat. Configurarea nu a fost salvată.');
   await rpc('save_config',{config});return reply({connected:true,mode:config.mode});
  }
  const id=body.id;
  if(body.action==='label') {
   const job=await rpc('job',{id});if(job.state!=='ready'||!job.label_path)throw new Error('Eticheta nu este disponibilă.');
   const signed=await service.storage.from('ams-live-labels').createSignedUrl(job.label_path,120,{download:`GLS-${job.awb}.pdf`});
   if(signed.error)throw new Error('Eticheta nu poate fi descărcată.');return reply({url:signed.data.signedUrl,awb:job.awb});
  }
  if(!['create','resolve'].includes(body.action))throw new Error('Acțiune invalidă.');
  let job=await rpc(body.action==='create'?'start':'resolve',body);
  if(job.state==='ready')return reply({state:'ready',awb:job.awb,mode:job.mode});
  if(job.state==='rejected')throw new Error(job.message||'Cerere respinsă de GLS.');
  const config=await worker('secret',{id});
  let result,info;
  if(body.action==='create') {
   const lock=await worker('dispatch',{id});
   if(!lock.dispatch)throw new Error('Cererea a fost deja trimisă. Folosește „Verifică în GLS”, fără a crea alt colet.');
   try {
    result=await carrier(config,'PrintLabels',{ParcelList:[{...job.parcel,PickupDate:glsDate(job.parcel.PickupDate)}],TypeOfPrinter:config.TypeOfPrinter,PrintPosition:1,ShowPrintDialog:false});
    const issue=errors(result,'PrintLabelsErrorList');
    if(issue&&!(result.PrintLabelsInfoList||[]).length){await worker('finish',{id,state:'rejected',message:issue});throw new Error(issue);}
    info=matchingParcel(result.PrintLabelsInfoList,job.reference);
   }catch(error){throw new Error(error.message+' Dacă rezultatul este necunoscut, folosește „Verifică în GLS”.');}
  } else {
   const from=Date.parse(job.created_at)-86400000;
   const listing=await carrier(config,'GetParcelList',{PrintDateFrom:glsDate(from),PrintDateTo:glsDate(Date.now()+86400000)});
   const issue=errors(listing,'GetParcelListErrors');if(issue)throw new Error(issue);
   info=matchingParcel(listing.PrintDataInfoList,job.reference);
   result=await carrier(config,'GetPrintedLabels',{ParcelIdList:[info.ParcelId],TypeOfPrinter:config.TypeOfPrinter,PrintPosition:1,ShowPrintDialog:false});
   const printIssue=errors(result,'GetPrintedLabelsErrorList');if(printIssue)throw new Error(printIssue);
  }
  const bytes=labelBytes(result.Labels),awb=String(info.ParcelNumber||'');
  if(!/^\d{6,20}$/.test(awb)||!Number.isInteger(info.ParcelId)||info.ParcelId<=0)throw new Error('Identificator GLS invalid. Verifică în MyGLS.');
  const path=`${owner_id}/${id}.pdf`;
  const uploaded=await service.storage.from('ams-live-labels').upload(path,bytes,{contentType:'application/pdf',upsert:true});
  if(uploaded.error)throw new Error('AWB creat la GLS, dar PDF-ul nu s-a salvat. Folosește „Verifică în GLS” pentru recuperare.');
  await worker('finish',{id,state:'ready',parcel_id:info.ParcelId,awb,label_path:path,message:null});
  return reply({state:'ready',awb,mode:job.mode});
 }catch(error){return reply({error:error instanceof Error?error.message:'Operațiunea GLS a eșuat.'},400);}
});
