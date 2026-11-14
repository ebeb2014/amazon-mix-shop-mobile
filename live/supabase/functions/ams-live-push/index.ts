import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import webpush from 'npm:web-push@3.6.7';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
async function rpc(action:string,data={}) {
 const r=await db.rpc('ams_live_push_worker',{p_action:action,p_data:data});
 if(r.error)throw new Error('Worker database operation failed');return r.data;
}
Deno.serve(async req=>{
 if(req.method!=='POST'||!req.headers.get('x-live-worker'))return new Response('Unauthorized',{status:401});
 try {
  const config=await rpc('config');
  if(!config?.ams_live_worker_token||req.headers.get('x-live-worker')!==config.ams_live_worker_token)return new Response('Unauthorized',{status:401});
  webpush.setVapidDetails('https://ebeb2014.github.io/amazon-mix-shop-mobile/live/',config.ams_live_vapid_public,config.ams_live_vapid_private);
  const jobs=await rpc('claim');
  await Promise.all(jobs.map(async job=>{
   let sent=false,expired=false;
   try{await webpush.sendNotification({endpoint:job.endpoint,keys:job.keys},JSON.stringify({title:'Amazon Mix Shop',body:job.title,tag:'live-'+job.event_id,url:'./#notificari'}),{TTL:3600,timeout:10000});sent=true;}
   catch(error){expired=[404,410].includes(error.statusCode);}
   await rpc('finish',{event_id:job.event_id,subscription_id:job.subscription_id,sent,expired});
  }));
  return Response.json({processed:jobs.length});
 }catch{return Response.json({error:'Notification worker failed'},{status:500});}
});
